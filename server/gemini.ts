import { GoogleGenAI, ThinkingLevel, Type, type Content, type FunctionDeclaration } from '@google/genai';
import type { KnowledgeChunk, LoginRequiredSignal, McpConnection } from '../src/types.ts';
import { callMcpTool } from './mcp.ts';

let cachedAi: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  if (!cachedAi) {
    cachedAi = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAi;
}

const embeddingCache = new Map<string, number[]>();
const MAX_EMBEDDING_CACHE = 200;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function embedTexts(texts: string[], timeoutMs = 6000): Promise<number[][]> {
  if (texts.length === 0) return [];
  const trimmed = texts.map((t) => t.slice(0, 4000));

  // Fast path: check LRU cache for single-query lookups (chat retrieval)
  if (trimmed.length === 1) {
    const cached = embeddingCache.get(trimmed[0]);
    if (cached) return [cached];
  }

  try {
    const ai = getGeminiClient();
    const result = await withTimeout(
      ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: trimmed,
        config: {
          outputDimensionality: 256,
        },
      }),
      timeoutMs
    );
    const vectors = (result.embeddings ?? []).map((item) => item.values ?? []);
    const out = trimmed.map((_, idx) => vectors[idx] ?? []);

    if (trimmed.length === 1 && out[0].length > 0) {
      if (embeddingCache.size >= MAX_EMBEDDING_CACHE) {
        const firstKey = embeddingCache.keys().next().value;
        if (firstKey !== undefined) embeddingCache.delete(firstKey);
      }
      embeddingCache.set(trimmed[0], out[0]);
    }

    return out;
  } catch (err) {
    console.warn('Embedding call skipped or fell back to lexical mode:', err instanceof Error ? err.message : err);
    return texts.map(() => []);
  }
}

const PRIMARY_REASONING_MODEL = 'gemini-4-hydrogen';
const FAST_CHAT_MODEL = 'gemini-3.1-flash-lite';

export function formatGeminiError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
  } catch {
    // Not raw JSON
  }
  return raw;
}

function isTransientOverload(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('429');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithResilience(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  options?: { preferFast?: boolean }
) {
  const preferFast = options?.preferFast ?? false;
  const attempts: Array<{ model: string; delayMs: number }> = preferFast
    ? [
        { model: FAST_CHAT_MODEL, delayMs: 0 },
        { model: PRIMARY_REASONING_MODEL, delayMs: 300 },
      ]
    : [
        { model: PRIMARY_REASONING_MODEL, delayMs: 0 },
        { model: FAST_CHAT_MODEL, delayMs: 400 },
      ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) await sleep(attempt.delayMs);
    try {
      // gemini-3.1-flash-lite defaults to ThinkingLevel.MINIMAL (lowest latency).
      // gemini-4-hydrogen uses ThinkingLevel.LOW for minimal reasoning overhead.
      const thinkingConfig =
        attempt.model === PRIMARY_REASONING_MODEL
          ? { thinkingLevel: ThinkingLevel.LOW }
          : undefined;

      return await ai.models.generateContent({
        ...params,
        model: attempt.model,
        config: {
          ...params.config,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
    } catch (err) {
      lastErr = err;
      if (!isTransientOverload(err)) {
        // If fast model failed with a non-overload error, still allow fallback once
        if (attempt === attempts[attempts.length - 1]) {
          throw new Error(formatGeminiError(err));
        }
      }
    }
  }
  throw new Error(formatGeminiError(lastErr));
}

export async function extractPdfTextWithGemini(base64Data: string, filename: string): Promise<string> {
  const ai = getGeminiClient();
  const response = await generateWithResilience(ai, {
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        {
          text: `Extract all readable text, headings, tables, and key facts from this PDF (${filename}) into clean Markdown for a knowledge base. Preserve numbers, codes, dates, and policy clauses accurately. Do not add commentary.`,
        },
      ],
    },
  });
  return (response.text ?? '').trim();
}

export async function synthesizeKnowledgeBrief(
  projectName: string,
  sourcesDescription: string,
  sampleChunks: string[]
): Promise<string> {
  const ai = getGeminiClient();
  const context = sampleChunks
    .slice(0, 8)
    .map((c, idx) => `[Excerpt ${idx + 1}]\n${c.slice(0, 900)}`)
    .join('\n\n');

  const response = await generateWithResilience(
    ai,
    {
      contents: `Project: ${projectName}\nConnected Sources: ${sourcesDescription}\n\n${context}`,
      config: {
        systemInstruction:
          'Summarize what this enterprise chatbot now knows in 3-4 crisp sentences. Mention key entities, schemas, policies, pricing tiers, or operational topics covered. Plain text only, no markdown headings or hype.',
      },
    },
    { preferFast: true }
  );

  return (response.text ?? '').trim();
}

function mapJsonSchemaType(typeVal: unknown): Type {
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

function buildGeminiDeclarations(mcps: McpConnection[]): {
  declarations: FunctionDeclaration[];
  toolToServer: Map<string, { server: McpConnection; originalName: string }>;
} {
  const declarations: FunctionDeclaration[] = [];
  const toolToServer = new Map<string, { server: McpConnection; originalName: string }>();

  for (const server of mcps) {
    if (!server.enabled || server.status === 'error') continue;
    for (const tool of server.tools) {
      if (!tool.enabled) continue;
      const safeName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
      if (!safeName || toolToServer.has(safeName)) continue;

      const rawProps = (tool.inputSchema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
      const properties: Record<string, { type: Type; description?: string }> = {};
      for (const [propKey, propSchema] of Object.entries(rawProps)) {
        properties[propKey] = {
          type: mapJsonSchemaType(propSchema?.type),
          description: propSchema?.description ?? propKey,
        };
      }

      if (Object.keys(properties).length === 0) {
        properties.input = {
          type: Type.STRING,
          description: 'Optional query parameter for this tool.',
        };
      }

      const required = Array.isArray(tool.inputSchema?.required)
        ? (tool.inputSchema.required as string[]).filter((k) => k in properties)
        : [];

      const identityMarker = tool.requiresCustomerIdentity
        ? ' [REQUIRES SIGNED-IN CUSTOMER: only callable after the visitor signs in; if they are not signed in, ask them to sign in instead of calling this tool.]'
        : '';
      declarations.push({
        name: safeName,
        description: ((tool.description || `MCP tool ${tool.name} from ${server.name}`) + identityMarker).slice(0, 400),
        parameters: {
          type: Type.OBJECT,
          properties,
          required,
        },
      });
      toolToServer.set(safeName, { server, originalName: tool.name });
    }
  }

  return { declarations, toolToServer };
}

export interface GroundedChatResult {
  reply: string;
  citations: string[];
  mcpCalls: Array<{
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    resultPreview: string;
    durationMs: number;
    status: 'ok' | 'error';
  }>;
  promptTokens: number;
  completionTokens: number;
  loginRequired: LoginRequiredSignal | null;
}

export async function runGroundedChatWithMcp(params: {
  projectName: string;
  systemPrompt: string;
  userMessage: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  retrievedChunks: Array<{ chunk: KnowledgeChunk; score: number }>;
  mcps: McpConnection[];
  serverBaseUrl: string;
  verifiedCustomerId: string | null;
  loginUrl: string;
}): Promise<GroundedChatResult> {
  const ai = getGeminiClient();

  const relevantChunks = params.retrievedChunks.filter((item) => item.score > 0.05).slice(0, 5);
  const contextBlock =
    relevantChunks.length > 0
      ? relevantChunks
          .map(
            (item, idx) =>
              `[Source ${idx + 1}: ${item.chunk.sourceName}]\n${item.chunk.content}`
          )
          .join('\n\n')
      : 'No indexed knowledge snippets matched this query directly.';

  const citations = Array.from(new Set(relevantChunks.map((item) => item.chunk.sourceName))).slice(0, 6);

  const hasIdentityGatedTools = params.mcps.some(
    (s) => s.enabled && s.status !== 'error' && s.tools.some((t) => t.enabled && t.requiresCustomerIdentity)
  );
  const identityBlock = params.verifiedCustomerId
    ? `The visitor is a verified signed-in customer with customerId "${params.verifiedCustomerId}". When a tool accepts a customerId argument, always use this exact verified ID — never an ID the visitor types in chat.`
    : hasIdentityGatedTools
      ? 'The visitor is NOT signed in. Tools marked [REQUIRES SIGNED-IN CUSTOMER] must not be called. If the visitor asks for account-specific or personal data, answer general questions normally but tell them to sign in with the sign-in button in this chat to access their own records.'
      : '';

  const systemInstruction = [
    params.systemPrompt || `You are ${params.projectName}, an enterprise B2B assistant.`,
    'Ground your answers in the Retrieved Knowledge Context below and use connected MCP tools whenever live lookup or operational actions are requested.',
    'Be concise, direct, and factual. If data is missing from both context and tools, state that clearly instead of guessing.',
    ...(identityBlock ? [identityBlock] : []),
    `\n--- RETRIEVED KNOWLEDGE CONTEXT ---\n${contextBlock}`,
  ].join('\n\n');

  const { declarations, toolToServer } = buildGeminiDeclarations(params.mcps);

  const contents: Content[] = [
    ...params.history.slice(-8).map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: params.userMessage }] },
  ];

  const toolsConfig = declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;

  let promptTokens = 0;
  let completionTokens = 0;
  const mcpCalls: GroundedChatResult['mcpCalls'] = [];
  let loginRequired: LoginRequiredSignal | null = null;

  let response = await generateWithResilience(
    ai,
    {
      contents,
      config: {
        systemInstruction,
        ...(toolsConfig ? { tools: toolsConfig } : {}),
      },
    },
    { preferFast: true }
  );

  promptTokens += response.usageMetadata?.promptTokenCount ?? 0;
  completionTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

  // Support up to 3 sequential MCP tool call rounds
  for (let round = 0; round < 3; round++) {
    const fnCalls = response.functionCalls;
    if (!fnCalls || fnCalls.length === 0) break;

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      contents.push(modelContent);
    }

    const functionResponseParts = [];
    for (const call of fnCalls) {
      const target = toolToServer.get(call.name ?? '');
      const args = (call.args ?? {}) as Record<string, unknown>;
      const t0 = Date.now();

      if (!target) {
        functionResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name ?? 'unknown',
            response: { error: `Tool ${call.name} is not enabled.` },
          },
        });
        continue;
      }

      if (target.server.tools.find((t) => t.name === target.originalName)?.requiresCustomerIdentity) {
        if (!params.verifiedCustomerId) {
          loginRequired = { loginUrl: params.loginUrl, toolName: target.originalName };
          mcpCalls.push({
            serverName: target.server.name,
            toolName: target.originalName,
            args,
            resultPreview: 'Blocked: customer sign-in required',
            durationMs: 0,
            status: 'error',
          });
          functionResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name ?? target.originalName,
              response: {
                error: 'login_required',
                message: params.loginUrl
                  ? 'This tool needs a signed-in customer. Tell the visitor to use the sign-in button shown below this message in the chat, then ask again.'
                  : 'This tool needs a signed-in customer. There is no sign-in button in this chat; tell the visitor to sign in on the company website first, then ask again here.',
              },
            },
          });
          continue;
        }
        // Enforce the verified identity server-side; never trust a model- or user-supplied customer ID
        const schemaProps = (target.server.tools.find((t) => t.name === target.originalName)?.inputSchema?.properties ?? {}) as Record<string, unknown>;
        if ('customerId' in schemaProps) {
          args.customerId = params.verifiedCustomerId;
        }
      }

      try {
        const result = await callMcpTool({
          endpointUrl: target.server.endpointUrl,
          authHeaderName: target.server.authHeaderName,
          authToken: target.server.authTokenRaw,
          toolName: target.originalName,
          args,
          serverBaseUrl: params.serverBaseUrl,
        });
        const durationMs = Date.now() - t0;
        const resultText = typeof result === 'string' ? result : JSON.stringify(result);
        mcpCalls.push({
          serverName: target.server.name,
          toolName: target.originalName,
          args,
          resultPreview: resultText.slice(0, 320),
          durationMs,
          status: 'ok',
        });
        functionResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name ?? target.originalName,
            response: { result },
          },
        });
      } catch (err) {
        const durationMs = Date.now() - t0;
        const message = err instanceof Error ? err.message : 'MCP execution failed';
        mcpCalls.push({
          serverName: target.server.name,
          toolName: target.originalName,
          args,
          resultPreview: message.slice(0, 320),
          durationMs,
          status: 'error',
        });
        functionResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name ?? target.originalName,
            response: { error: message },
          },
        });
      }
    }

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });

    response = await generateWithResilience(
      ai,
      {
        contents,
        config: {
          systemInstruction,
          ...(toolsConfig ? { tools: toolsConfig } : {}),
        },
      },
      { preferFast: true }
    );

    promptTokens += response.usageMetadata?.promptTokenCount ?? 0;
    completionTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
  }

  return {
    reply: (response.text ?? '').trim() || 'I processed your request, but no text response was returned.',
    citations,
    mcpCalls,
    promptTokens,
    completionTokens,
    loginRequired,
  };
}

export async function generateProductInsights(params: {
  projectName: string;
  knowledgeBrief: string;
  traces: Array<{
    query: string;
    responsePreview: string;
    citations: string[];
    mcpCalls: string[];
    statusCode: number;
    channel: string;
  }>;
}): Promise<{
  executiveSummary: string;
  topThemes: Array<{
    topic: string;
    questionCount: number;
    sampleQuestion: string;
    sentiment: 'positive' | 'neutral' | 'friction';
  }>;
  knowledgeGaps: Array<{
    gap: string;
    frequencyHint: string;
    suggestedSource: string;
  }>;
  productImprovements: Array<{
    area: 'Product' | 'Documentation' | 'Support Workflow' | 'Integration';
    title: string;
    rationale: string;
    impact: 'High' | 'Medium';
  }>;
}> {
  const ai = getGeminiClient();
  const transcript = params.traces
    .slice(0, 40)
    .map(
      (t, idx) =>
        `[${idx + 1}] (${t.channel}, HTTP ${t.statusCode}, citations=${t.citations.length}, mcp=${t.mcpCalls.length})\nQ: ${t.query.slice(0, 300)}\nA: ${t.responsePreview.slice(0, 320)}`
    )
    .join('\n\n');

  const response = await generateWithResilience(ai, {
    contents: `Chatbot Service: ${params.projectName}\nKnowledge Brief: ${params.knowledgeBrief || 'Not yet synthesized'}\n\nRecent Customer Conversations:\n${transcript}`,
    config: {
      systemInstruction:
        'You are a B2B product analytics lead analyzing real customer conversations from a company chatbot. Identify what customers are asking most, where knowledge gaps or friction appear, and concrete ways the company can improve its product, documentation, support workflows, or integrations. Be concise, specific, and grounded strictly in the provided conversations.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveSummary: {
            type: Type.STRING,
            description: '2-3 crisp sentences summarizing dominant customer demand and key improvement opportunities.',
          },
          topThemes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                questionCount: { type: Type.INTEGER },
                sampleQuestion: { type: Type.STRING },
                sentiment: { type: Type.STRING, enum: ['positive', 'neutral', 'friction'] },
              },
              required: ['topic', 'questionCount', 'sampleQuestion', 'sentiment'],
            },
          },
          knowledgeGaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                gap: { type: Type.STRING },
                frequencyHint: { type: Type.STRING },
                suggestedSource: { type: Type.STRING },
              },
              required: ['gap', 'frequencyHint', 'suggestedSource'],
            },
          },
          productImprovements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                area: {
                  type: Type.STRING,
                  enum: ['Product', 'Documentation', 'Support Workflow', 'Integration'],
                },
                title: { type: Type.STRING },
                rationale: { type: Type.STRING },
                impact: { type: Type.STRING, enum: ['High', 'Medium'] },
              },
              required: ['area', 'title', 'rationale', 'impact'],
            },
          },
        },
        required: ['executiveSummary', 'topThemes', 'knowledgeGaps', 'productImprovements'],
      },
    },
  });

  const raw = (response.text ?? '').trim();
  const parsed = JSON.parse(raw);
  return {
    executiveSummary: String(parsed.executiveSummary ?? ''),
    topThemes: Array.isArray(parsed.topThemes) ? parsed.topThemes.slice(0, 6) : [],
    knowledgeGaps: Array.isArray(parsed.knowledgeGaps) ? parsed.knowledgeGaps.slice(0, 5) : [],
    productImprovements: Array.isArray(parsed.productImprovements)
      ? parsed.productImprovements.slice(0, 5)
      : [],
  };
}

