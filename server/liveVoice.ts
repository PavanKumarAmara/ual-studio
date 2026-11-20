import type { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import { formatGeminiError } from './gemini.ts';
import { callMcpTool } from './mcp.ts';
import { appendRuntimeTrace, getBotBySlug } from './runtimeStore.ts';
import { rankChunks } from '../src/utils/retrieval.ts';
import { normalizeVoiceName } from '../src/utils/voiceAudio.ts';
import type { BotRuntimeSnapshot, McpConnection, TraceChannel, TraceLog } from '../src/types.ts';

const LIVE_MODEL = 'gemini-3.8-live';

let cachedLiveAi: GoogleGenAI | null = null;
function getGeminiLiveClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  if (!cachedLiveAi) {
    cachedLiveAi = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedLiveAi;
}

function mapSchemaType(typeVal: unknown): Type {
  switch (String(typeVal ?? '').toLowerCase()) {
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

function buildLiveToolDeclarations(bot: BotRuntimeSnapshot): {
  declarations: FunctionDeclaration[];
  mcpToolMap: Map<string, { server: McpConnection; originalName: string }>;
} {
  const declarations: FunctionDeclaration[] = [];
  const mcpToolMap = new Map<string, { server: McpConnection; originalName: string }>();

  if (bot.chunks.length > 0) {
    declarations.push({
      name: 'search_knowledge_base',
      description:
        'Search the shop or company indexed knowledge base (pricing, policies, FAQs, documentation, database schemas) for specific facts.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'Concise search query covering the customer question.',
          },
        },
        required: ['query'],
      },
    });
  }

  for (const server of bot.mcps) {
    if (!server.enabled || server.status === 'error') continue;
    for (const tool of server.tools) {
      if (!tool.enabled) continue;
      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
      if (!safeName || safeName === 'search_knowledge_base' || mcpToolMap.has(safeName)) continue;

      const rawProps = (tool.inputSchema?.properties ?? {}) as Record<
        string,
        { type?: string; description?: string }
      >;
      const properties: Record<string, { type: Type; description?: string }> = {};
      for (const [k, v] of Object.entries(rawProps)) {
        properties[k] = {
          type: mapSchemaType(v?.type),
          description: v?.description ?? k,
        };
      }
      if (Object.keys(properties).length === 0) {
        properties.input = {
          type: Type.STRING,
          description: 'Optional input parameter for this tool.',
        };
      }
      const required = Array.isArray(tool.inputSchema?.required)
        ? (tool.inputSchema.required as string[]).filter((k) => k in properties)
        : [];

      declarations.push({
        name: safeName,
        description: (tool.description || `MCP tool ${tool.name} from ${server.name}`).slice(0, 350),
        parameters: {
          type: Type.OBJECT,
          properties,
          required,
        },
      });
      mcpToolMap.set(safeName, { server, originalName: tool.name });
    }
  }

  return { declarations, mcpToolMap };
}

function buildLiveSystemInstruction(bot: BotRuntimeSnapshot): string {
  const knowledgeSummary = bot.project.knowledgeBrief
    ? `Knowledge Overview: ${bot.project.knowledgeBrief}`
    : '';

  const topSnippets = bot.chunks
    .slice(0, 6)
    .map((c, idx) => `[Doc ${idx + 1} · ${c.sourceName}] ${c.content.slice(0, 650)}`)
    .join('\n');

  return [
    bot.project.systemPrompt || `You are ${bot.project.name} for ${bot.orgName}.`,
    'You are speaking in a real-time live voice conversation with a customer.',
    'Keep answers concise, warm, natural, and easy to follow aloud (typically 1-3 crisp sentences unless the user asks for details). Do not read raw markdown symbols, URLs, or code punctuation aloud.',
    'Ground every factual answer in the knowledge excerpts below, call search_knowledge_base for deeper policy/pricing lookups, and call connected MCP tools whenever live shipment, account, or ticket actions are requested.',
    knowledgeSummary,
    topSnippets ? `--- INDEXED KNOWLEDGE EXCERPTS ---\n${topSnippets}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function safeSend(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveVoiceServer(httpServer: HttpServer, port: number): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const rawUrl = request.url || '';
    const parsedUrl = new URL(rawUrl, `http://127.0.0.1:${port}`);
    const match = /^\/api\/v1\/bots\/([^/]+)\/live\/?$/.exec(parsedUrl.pathname);
    if (!match) {
      return;
    }

    const botSlug = decodeURIComponent(match[1]);
    const channelParam = (parsedUrl.searchParams.get('channel') || 'hosted').toLowerCase();
    const channel: TraceChannel = channelParam === 'widget' ? 'widget' : 'hosted';

    wss.handleUpgrade(request, socket, head, (ws) => {
      void handleLiveClientConnection(ws, botSlug, channel, port);
    });
  });

  return wss;
}

async function handleLiveClientConnection(
  clientWs: WebSocket,
  botSlug: string,
  channel: TraceChannel,
  port: number
): Promise<void> {
  const bot = getBotBySlug(botSlug);
  if (!bot) {
    safeSend(clientWs, { type: 'error', message: `Chatbot service "${botSlug}" was not found.` });
    clientWs.close(1008, 'Bot not found');
    return;
  }

  if (bot.project.status !== 'active') {
    safeSend(clientWs, { type: 'error', message: 'This chatbot service is currently paused.' });
    clientWs.close(1008, 'Bot paused');
    return;
  }

  if (!bot.project.theme.enableVoiceMode) {
    safeSend(clientWs, {
      type: 'error',
      message: 'Live voice mode is disabled for this shop. Enable it in Theme & Embed settings.',
    });
    clientWs.close(1008, 'Voice disabled');
    return;
  }

  const voiceName = normalizeVoiceName(bot.project.theme.voiceName);
  const { declarations, mcpToolMap } = buildLiveToolDeclarations(bot);
  const systemInstruction = buildLiveSystemInstruction(bot);
  const serverBaseUrl = `http://127.0.0.1:${port}`;

  let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
  let closed = false;

  // Track turn transcripts & tool usage for Observability traces
  let turnStartMs = Date.now();
  let currentUserText = '';
  let currentAssistantText = '';
  let turnToolCalls: string[] = [];
  let turnCitations: string[] = [];

  const flushTraceIfPresent = () => {
    const q = currentUserText.trim();
    const a = currentAssistantText.trim();
    if (!q && !a) return;
    const trace: TraceLog = {
      id: `tr_voice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orgId: bot.project.orgId,
      projectId: bot.project.id,
      ownerId: bot.project.ownerId,
      query: (q || '(Live voice input)').slice(0, 1900),
      responsePreview: (a || '(Spoken audio response)').slice(0, 1900),
      latencyMs: Math.max(120, Math.min(60000, Date.now() - turnStartMs)),
      promptTokens: Math.ceil(q.length / 4),
      completionTokens: Math.ceil(a.length / 4),
      statusCode: 200,
      channel,
      citations: Array.from(new Set(turnCitations)).slice(0, 10),
      mcpCalls: turnToolCalls.slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    appendRuntimeTrace(botSlug, trace);
    currentUserText = '';
    currentAssistantText = '';
    turnToolCalls = [];
    turnCitations = [];
    turnStartMs = Date.now();
  };

  try {
    const ai = getGeminiLiveClient();
    const sessionPromise = ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction,
        ...(declarations.length > 0 ? { tools: [{ functionDeclarations: declarations }] } : {}),
      },
      callbacks: {
        onopen: () => {
          // Wait until sessionPromise resolves (setupComplete) before notifying client ready
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed) return;

          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            const chunk = content.inputTranscription.text;
            if (!currentUserText) turnStartMs = Date.now();
            currentUserText += chunk;
            safeSend(clientWs, { type: 'inputTranscript', text: chunk });
          }

          if (content?.outputTranscription?.text) {
            const chunk = content.outputTranscription.text;
            currentAssistantText += chunk;
            safeSend(clientWs, { type: 'outputTranscript', text: chunk });
          }

          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              safeSend(clientWs, { type: 'audio', data: part.inlineData.data });
            }
          }

          if (content?.interrupted) {
            safeSend(clientWs, { type: 'interrupted' });
          }

          if (content?.turnComplete) {
            flushTraceIfPresent();
            safeSend(clientWs, { type: 'turnComplete' });
          }

          const functionCalls = message.toolCall?.functionCalls ?? [];
          if (functionCalls.length > 0) {
            void (async () => {
              const liveSession = await sessionPromise;
              const responses = [];

              for (const call of functionCalls) {
                const fnName = call.name ?? '';
                const args = (call.args ?? {}) as Record<string, unknown>;
                const t0 = Date.now();
                safeSend(clientWs, { type: 'tool', toolName: fnName, status: 'calling' });

                if (fnName === 'search_knowledge_base') {
                  const query = String(args.query ?? '').trim();
                  const ranked = rankChunks(query, [], bot.chunks, 4).filter((r) => r.score > 0.05);
                  for (const item of ranked) {
                    turnCitations.push(item.chunk.sourceName);
                  }
                  const summary =
                    ranked.length > 0
                      ? ranked.map((r) => `[${r.chunk.sourceName}] ${r.chunk.content}`).join('\n\n')
                      : 'No direct match found in indexed knowledge base.';
                  safeSend(clientWs, { type: 'tool', toolName: fnName, status: 'ok' });
                  responses.push({
                    id: call.id,
                    name: fnName,
                    response: { result: summary },
                  });
                  continue;
                }

                const target = mcpToolMap.get(fnName);
                if (!target) {
                  safeSend(clientWs, { type: 'tool', toolName: fnName, status: 'error' });
                  responses.push({
                    id: call.id,
                    name: fnName,
                    response: { error: `Tool "${fnName}" is not enabled.` },
                  });
                  continue;
                }

                try {
                  const result = await callMcpTool({
                    endpointUrl: target.server.endpointUrl,
                    authHeaderName: target.server.authHeaderName,
                    authToken: target.server.authTokenRaw,
                    toolName: target.originalName,
                    args,
                    serverBaseUrl,
                  });
                  const durationMs = Date.now() - t0;
                  turnToolCalls.push(
                    `${target.originalName}(${JSON.stringify(args).slice(0, 60)}) · ${durationMs}ms`
                  );
                  safeSend(clientWs, { type: 'tool', toolName: target.originalName, status: 'ok' });
                  responses.push({
                    id: call.id,
                    name: fnName,
                    response: { result },
                  });
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
                  safeSend(clientWs, { type: 'tool', toolName: target.originalName, status: 'error' });
                  responses.push({
                    id: call.id,
                    name: fnName,
                    response: { error: errMsg },
                  });
                }
              }

              if (!closed && responses.length > 0) {
                liveSession.sendToolResponse({ functionResponses: responses });
              }
            })();
          }
        },
        onerror: (err: unknown) => {
          const msg = formatGeminiError(err);
          console.error('Gemini Live session error:', msg);
          safeSend(clientWs, { type: 'error', message: `Voice session error: ${msg}` });
        },
        onclose: () => {
          if (!closed) {
            flushTraceIfPresent();
            closed = true;
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1000, 'Live session closed');
            }
          }
        },
      },
    });

    session = await sessionPromise;
    if (!closed) {
      safeSend(clientWs, {
        type: 'ready',
        voiceName,
        model: LIVE_MODEL,
        botName: bot.project.theme.headerTitle || bot.project.name,
      });
    }
  } catch (err) {
    const msg = formatGeminiError(err);
    console.error('Failed to connect to Gemini Live:', msg);
    safeSend(clientWs, { type: 'error', message: `Unable to start live voice: ${msg}` });
    clientWs.close(1011, 'Gemini Live init failed');
    return;
  }

  clientWs.on('message', (rawData) => {
    if (closed || !session) return;
    try {
      const msg = JSON.parse(rawData.toString()) as {
        type?: string;
        data?: string;
        text?: string;
      };
      if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
        session.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
        const cleanText = msg.text.trim();
        if (!currentUserText) turnStartMs = Date.now();
        currentUserText += cleanText;
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: cleanText }] }],
          turnComplete: true,
        });
      } else if (msg.type === 'stop') {
        closed = true;
        flushTraceIfPresent();
        try {
          session.close();
        } catch {
          // Ignore close errors
        }
        clientWs.close(1000, 'Stopped by user');
      }
    } catch {
      // Ignore malformed client frames
    }
  });

  clientWs.on('close', () => {
    if (closed) return;
    closed = true;
    flushTraceIfPresent();
    try {
      session?.close();
    } catch {
      // Ignore
    }
  });

  clientWs.on('error', () => {
    if (closed) return;
    closed = true;
    try {
      session?.close();
    } catch {
      // Ignore
    }
  });
}
