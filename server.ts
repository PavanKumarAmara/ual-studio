import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import multer from 'multer';
import { attachLiveVoiceServer } from './server/liveVoice.ts';
import {
  embedTexts,
  generateProductInsights,
  runGroundedChatWithMcp,
  synthesizeKnowledgeBrief,
} from './server/gemini.ts';
import {
  ingestFlatFile,
  ingestPostgresSource,
  ingestPublicS3Folder,
  ingestWebsiteSource,
} from './server/connectors.ts';
import { discoverMcpTools, handleDemoMcpJsonRpc } from './server/mcp.ts';
import { verifyCustomerIdentity } from './server/identity.ts';
import {
  appendRuntimeTrace,
  getBotByOrgAndSlug,
  getRuntimeTraces,
  listRuntimeBots,
  syncBotSnapshot,
} from './server/runtimeStore.ts';
import { rankChunks } from './src/utils/retrieval.ts';
import type { BotRuntimeSnapshot, TraceChannel, TraceLog } from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  // Basic CORS for customer-embedded chat widgets and external API callers
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/bots/') || req.path.startsWith('/embed/') || req.path.startsWith('/api/public/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-RelayMesh-Channel');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // 1. Built-in Live Demo MCP Server (Streamable HTTP JSON-RPC 2.0)
  app.post('/api/mcp/demo', (req, res) => {
    const response = handleDemoMcpJsonRpc((req.body ?? {}) as Record<string, unknown>);
    res.json(response);
  });

  // 2. Runtime Sync Endpoint (keeps public bot endpoints & hosted URLs synced with workspace/Firestore)
  app.get('/api/runtime/bots', (_req, res) => {
    res.json({ bots: listRuntimeBots() });
  });

  app.post('/api/runtime/sync', (req, res) => {
    const snapshot = req.body as BotRuntimeSnapshot;
    if (!snapshot?.project?.slug || !snapshot?.orgSlug) {
      res.status(400).json({ error: 'Invalid bot snapshot payload.' });
      return;
    }
    syncBotSnapshot(snapshot);
    res.json({ ok: true, slug: snapshot.project.slug });
  });

  app.get('/api/runtime/traces/:orgSlug/:botSlug', (req, res) => {
    res.json({ traces: getRuntimeTraces(req.params.orgSlug, req.params.botSlug) });
  });

  // 3. Public Safe Bot Config (for Hosted Chat URL /c/:orgSlug/:botSlug & Embed Widget — never leaks API keys)
  app.get('/api/public/bots/:orgSlug/:botSlug', (req, res) => {
    const bot = getBotByOrgAndSlug(req.params.orgSlug, req.params.botSlug);
    if (!bot) {
      res.status(404).json({ error: 'Chatbot service not found.' });
      return;
    }
    res.json({
      orgSlug: bot.orgSlug,
      orgName: bot.orgName,
      project: {
        id: bot.project.id,
        name: bot.project.name,
        slug: bot.project.slug,
        description: bot.project.description,
        status: bot.project.status,
        theme: bot.project.theme,
        sourceCount: bot.project.sourceCount,
        chunkCount: bot.project.chunkCount,
      },
      mcpToolCount: bot.mcps
        .filter((m) => m.enabled && m.status === 'connected')
        .reduce((sum, m) => sum + m.tools.filter((t) => t.enabled).length, 0),
    });
  });

  // 3b. Public Store Page Config (hosted storefront /s/:orgSlug/:botSlug — safe fields only)
  app.get('/api/public/pages/:orgSlug/:botSlug', (req, res) => {
    const bot = getBotByOrgAndSlug(req.params.orgSlug, req.params.botSlug);
    if (!bot || !bot.project.storePage?.published) {
      res.status(404).json({ error: 'Store page not found or not published.' });
      return;
    }
    res.json({
      orgSlug: bot.orgSlug,
      orgName: bot.orgName,
      botSlug: bot.project.slug,
      page: bot.project.storePage,
      chatEnabled: bot.project.status === 'active',
    });
  });

  // 4. Generated Production Chatbot Endpoint
  app.post('/api/v1/bots/:orgSlug/:botSlug/chat', async (req, res) => {
    const started = Date.now();
    const { orgSlug, botSlug } = req.params;
    const bot = getBotByOrgAndSlug(orgSlug, botSlug);

    if (!bot) {
      res.status(404).json({ error: `Chatbot endpoint "${orgSlug}/${botSlug}" does not exist.` });
      return;
    }

    if (bot.project.status !== 'active') {
      res.status(503).json({ error: 'This chatbot service is currently paused.' });
      return;
    }

    const channelHeader = String(req.headers['x-relaymesh-channel'] ?? '').toLowerCase();
    const channel: TraceChannel =
      channelHeader === 'hosted' || channelHeader === 'widget' || channelHeader === 'playground'
        ? channelHeader
        : 'api';

    // Require Bearer API key for external /api channel calls
    if (channel === 'api') {
      const authHeader = String(req.headers.authorization ?? '');
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token || token !== bot.project.apiKey) {
        const failedTrace: TraceLog = {
          id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          orgId: bot.project.orgId,
          projectId: bot.project.id,
          ownerId: bot.project.ownerId,
          query: String(req.body?.message ?? '(unauthorized request)').slice(0, 200),
          responsePreview: '401 Unauthorized: Invalid or missing Bearer API key',
          latencyMs: Date.now() - started,
          promptTokens: 0,
          completionTokens: 0,
          statusCode: 401,
          channel,
          citations: [],
          mcpCalls: [],
          createdAt: new Date().toISOString(),
        };
        appendRuntimeTrace(orgSlug, botSlug, failedTrace);
        res.status(401).json({ error: 'Unauthorized: Provide Authorization: Bearer <project_api_key>.' });
        return;
      }
    }

    const message = String(req.body?.message ?? '').trim();
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as Array<{ role: 'user' | 'assistant'; content: string }>)
      : [];

    if (!message) {
      res.status(400).json({ error: 'Field "message" is required.' });
      return;
    }

    try {
      const rawIdentity = req.body?.customerIdentity;
      const identity = rawIdentity && typeof rawIdentity === 'object'
        ? verifyCustomerIdentity(bot.project.identitySecret ?? '', {
            customerId: String(rawIdentity.customerId ?? ''),
            sig: String(rawIdentity.sig ?? ''),
            ts: Number(rawIdentity.ts ?? 0),
          })
        : { valid: false, customerId: null };

      const hasEmbeddedChunks = bot.chunks.some((c) => c.embedding.length > 0);
      const queryEmbedding = hasEmbeddedChunks ? (await embedTexts([message], 2500))[0] ?? [] : [];
      const retrieved = rankChunks(message, queryEmbedding, bot.chunks, 5);

      const serverBaseUrl = `http://127.0.0.1:${PORT}`;
      const result = await runGroundedChatWithMcp({
        projectName: bot.project.name,
        systemPrompt: bot.project.systemPrompt,
        userMessage: message,
        history,
        retrievedChunks: retrieved,
        mcps: bot.mcps,
        serverBaseUrl,
        verifiedCustomerId: identity.valid ? identity.customerId : null,
        loginUrl: bot.project.loginUrl ?? '',
      });

      const latencyMs = Date.now() - started;
      const trace: TraceLog = {
        id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orgId: bot.project.orgId,
        projectId: bot.project.id,
        ownerId: bot.project.ownerId,
        query: message.slice(0, 1900),
        responsePreview: result.reply.slice(0, 1900),
        latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        statusCode: 200,
        channel,
        citations: result.citations.slice(0, 10),
        mcpCalls: result.mcpCalls
          .map((c) => `${c.toolName}(${JSON.stringify(c.args).slice(0, 80)}) · ${c.durationMs}ms`)
          .slice(0, 10),
        createdAt: new Date().toISOString(),
      };
      appendRuntimeTrace(orgSlug, botSlug, trace);

      res.json({
        reply: result.reply,
        citations: result.citations,
        mcpCalls: result.mcpCalls,
        loginRequired: result.loginRequired,
        usage: {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.promptTokens + result.completionTokens,
        },
        latencyMs,
        trace,
      });
    } catch (err) {
      const latencyMs = Date.now() - started;
      const errorMessage = err instanceof Error ? err.message : 'Chat execution error';
      const errTrace: TraceLog = {
        id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        orgId: bot.project.orgId,
        projectId: bot.project.id,
        ownerId: bot.project.ownerId,
        query: message.slice(0, 1900),
        responsePreview: `Error: ${errorMessage.slice(0, 500)}`,
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        statusCode: 500,
        channel,
        citations: [],
        mcpCalls: [],
        createdAt: new Date().toISOString(),
      };
      appendRuntimeTrace(orgSlug, botSlug, errTrace);
      res.status(500).json({ error: errorMessage, trace: errTrace });
    }
  });

  // 5. Embeddable Floating Widget Script (/embed/:orgSlug/:botSlug.js)
  app.get('/embed/:orgSlug/:botSlug.js', (req, res) => {
    const { orgSlug, botSlug } = req.params;
    const bot = getBotByOrgAndSlug(orgSlug, botSlug);
    if (!bot) {
      res.type('application/javascript').status(404).send(`console.error("UAL: Bot ${orgSlug}/${botSlug} not found.");`);
      return;
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    const chatUrl = `${origin}/c/${bot.orgSlug}/${bot.project.slug}?embed=1`;
    const color = bot.project.theme.primaryColor || '#2563EB';
    const side = bot.project.theme.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;';
    const radius = bot.project.theme.borderRadius ?? 12;
    const allowMicAttr = bot.project.theme.enableVoiceMode ? `frame.allow = 'microphone';\n  ` : '';

    const script = `(function(){
  if (window.__relayMeshLoaded_${orgSlug.replace(/[^a-zA-Z0-9]/g, '_')}_${botSlug.replace(/[^a-zA-Z0-9]/g, '_')}) return;
  window.__relayMeshLoaded_${orgSlug.replace(/[^a-zA-Z0-9]/g, '_')}_${botSlug.replace(/[^a-zA-Z0-9]/g, '_')} = true;
  var cur = document.currentScript;
  var cid = cur && cur.getAttribute ? cur.getAttribute('data-customer-id') : '';
  var csig = cur && cur.getAttribute ? cur.getAttribute('data-customer-sig') : '';
  var cts = cur && cur.getAttribute ? cur.getAttribute('data-customer-ts') : '';
  var srcUrl = ${JSON.stringify(chatUrl)} + (cid ? '&customerId=' + encodeURIComponent(cid) : '') + (csig ? '&sig=' + encodeURIComponent(csig) : '') + (cts ? '&ts=' + encodeURIComponent(cts) : '');
  var btn = document.createElement('button');
  btn.setAttribute('aria-label', ${JSON.stringify(bot.project.theme.headerTitle)});
  btn.textContent = 'Chat';
  btn.style.cssText = 'position:fixed;bottom:20px;${side}z-index:2147483647;background:${color};color:#fff;border:none;border-radius:9999px;padding:12px 18px;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 25px rgba(15,23,42,0.18);';
  var frame = document.createElement('iframe');
  frame.src = srcUrl;
  ${allowMicAttr}frame.style.cssText = 'display:none;position:fixed;bottom:76px;${side}z-index:2147483647;width:390px;max-width:calc(100vw - 32px);height:580px;max-height:calc(100vh - 104px);border:1px solid #e2e8f0;border-radius:${radius}px;box-shadow:0 20px 40px rgba(15,23,42,0.16);background:#fff;';
  var open = false;
  btn.onclick = function(){ open = !open; frame.style.display = open ? 'block' : 'none'; btn.textContent = open ? 'Close' : 'Chat'; };
  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();`;

    res.type('application/javascript').send(script);
  });

  // 6. Data Connector Ingestion Endpoints
  app.post('/api/ingest/flatfile', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select a file (.csv, .md, .txt, .json, or .pdf).' });
        return;
      }
      const projectName = String(req.body?.projectName ?? 'Chatbot Service');
      const result = await ingestFlatFile(file);
      let knowledgeBrief = result.summary;
      try {
        knowledgeBrief = await synthesizeKnowledgeBrief(
          projectName,
          result.name,
          result.chunks.map((c) => c.content)
        );
      } catch (err) {
        console.warn('Knowledge brief synthesis fallback:', err instanceof Error ? err.message : err);
      }
      res.json({ ...result, knowledgeBrief });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to ingest file.' });
    }
  });

  app.post('/api/ingest/postgres', async (req, res) => {
    try {
      const { uri, tableFilter, projectName, useSampleSchema } = req.body ?? {};
      const result = await ingestPostgresSource({
        uri: String(uri ?? ''),
        tableFilter: String(tableFilter ?? ''),
        useSampleSchema: Boolean(useSampleSchema),
      });
      let knowledgeBrief = result.summary;
      try {
        knowledgeBrief = await synthesizeKnowledgeBrief(
          String(projectName ?? 'Chatbot Service'),
          result.name,
          result.chunks.map((c) => c.content)
        );
      } catch (err) {
        console.warn('Knowledge brief synthesis fallback:', err instanceof Error ? err.message : err);
      }
      res.json({ ...result, knowledgeBrief });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'PostgreSQL ingestion failed.' });
    }
  });

  app.post('/api/ingest/s3-public', async (req, res) => {
    try {
      const { folderUrl, projectName, useSampleBucket } = req.body ?? {};
      const result = await ingestPublicS3Folder({
        folderUrl: String(folderUrl ?? ''),
        useSampleBucket: Boolean(useSampleBucket),
      });
      let knowledgeBrief = result.summary;
      try {
        knowledgeBrief = await synthesizeKnowledgeBrief(
          String(projectName ?? 'Chatbot Service'),
          result.name,
          result.chunks.map((c) => c.content)
        );
      } catch (err) {
        console.warn('Knowledge brief synthesis fallback:', err instanceof Error ? err.message : err);
      }
      res.json({ ...result, knowledgeBrief });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Public S3 folder ingestion failed.' });
    }
  });

  app.post('/api/ingest/website', async (req, res) => {
    const started = Date.now();
    try {
      const { url, additionalUrls, maxPages, projectName, useSampleWebsite } = req.body ?? {};
      const parsedAdditional = Array.isArray(additionalUrls)
        ? additionalUrls.map((u) => String(u)).filter(Boolean)
        : [];
      const result = await ingestWebsiteSource({
        url: String(url ?? ''),
        additionalUrls: parsedAdditional,
        maxPages: Number(maxPages ?? 5),
        useSampleWebsite: Boolean(useSampleWebsite),
      });
      let knowledgeBrief = result.summary;
      try {
        knowledgeBrief = await synthesizeKnowledgeBrief(
          String(projectName ?? 'Chatbot Service'),
          result.name,
          result.chunks.map((c) => c.content)
        );
      } catch (err) {
        console.warn('Knowledge brief synthesis fallback:', err instanceof Error ? err.message : err);
      }
      res.json({ ...result, knowledgeBrief, durationMs: Date.now() - started });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Website scraping failed.' });
    }
  });

  // 7. MCP Tool Discovery Endpoint
  app.post('/api/mcp/discover', async (req, res) => {
    try {
      const { endpointUrl, authHeaderName, authToken } = req.body ?? {};
      if (!endpointUrl || typeof endpointUrl !== 'string') {
        res.status(400).json({ error: 'MCP endpoint URL is required.' });
        return;
      }
      const discovered = await discoverMcpTools({
        endpointUrl,
        authHeaderName: typeof authHeaderName === 'string' ? authHeaderName : undefined,
        authToken: typeof authToken === 'string' ? authToken : undefined,
        serverBaseUrl: `http://127.0.0.1:${PORT}`,
      });
      res.json(discovered);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to discover MCP tools.' });
    }
  });

  // 8. Customer Question Analytics & Product Improvement Insights Endpoint
  app.post('/api/analytics/insights', async (req, res) => {
    try {
      const { projectName, knowledgeBrief, traces } = req.body ?? {};
      if (!Array.isArray(traces) || traces.length === 0) {
        res.status(400).json({ error: 'At least one conversation trace is required to generate insights.' });
        return;
      }
      const report = await generateProductInsights({
        projectName: String(projectName ?? 'Chatbot Service'),
        knowledgeBrief: String(knowledgeBrief ?? ''),
        traces: traces.slice(0, 40),
      });
      res.json({
        ...report,
        generatedAt: new Date().toISOString(),
        analyzedTraceCount: Math.min(traces.length, 40),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate customer insights.',
      });
    }
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  attachLiveVoiceServer(httpServer, PORT);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Unified Agentic Layer (UAL) server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
