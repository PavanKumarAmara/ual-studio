import type { Express, Request, Response } from 'express';
import { digest, opaqueToken } from './identity.ts';

export const UAL_SUPPORT_ORIGIN = 'https://ual-studio.ai.studio';
export const DEFAULT_CHATBOT_URL = `${UAL_SUPPORT_ORIGIN}/api/v1/bots/customer-support-bot/chat`;
const COOKIE = 'np_support';
const MAX_RESPONSE_BYTES = 256 * 1024;
const SESSION_TTL = 60 * 60 * 1000;
const MAX_CONNECTIONS = 100;

type Turn = { role: 'user' | 'assistant'; content: string; citations?: string[] };
type Connection = {
  endpoint: string;
  apiKey: string;
  messages: Turn[];
  expiresAt: number;
  busy: boolean;
  controller?: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

class SupportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Only this explicitly trusted service receives keys. Paths are reconstructed, not forwarded.
export function normalizeChatbotUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 1000) throw new SupportError(400, 'Enter a UAL chatbot URL.');
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new SupportError(400, 'Enter a valid chatbot URL.'); }
  if (url.origin !== UAL_SUPPORT_ORIGIN || url.username || url.password || url.search || url.hash) {
    throw new SupportError(400, `Use a chatbot URL on ${UAL_SUPPORT_ORIGIN}, without query parameters or credentials.`);
  }
  const scoped = /^\/api\/v1\/businesses\/([A-Za-z0-9_-]{1,128})\/bots\/([A-Za-z0-9_-]{1,128})\/chat\/?$/.exec(url.pathname);
  const scopedHosted = /^\/c\/(org_[A-Za-z0-9_-]{1,124})\/(proj_[A-Za-z0-9_-]{1,123})\/?$/.exec(url.pathname);
  const ids = scoped ?? scopedHosted;
  if (ids) return `${UAL_SUPPORT_ORIGIN}/api/v1/businesses/${ids[1]}/bots/${ids[2]}/chat`;
  const rest = /^\/api\/v1\/bots\/([a-z0-9][a-z0-9-]{0,99})\/chat\/?$/.exec(url.pathname);
  const hosted = /^\/c\/[a-z0-9][a-z0-9-]{0,99}\/([a-z0-9][a-z0-9-]{0,99})\/?$/.exec(url.pathname);
  const slug = rest?.[1] ?? hosted?.[1];
  if (!slug) throw new SupportError(400, 'Paste the REST Chat Endpoint or Hosted Customer Chat URL, not the widget script.');
  return `${UAL_SUPPORT_ORIGIN}/api/v1/bots/${slug}/chat`;
}

async function readChatResponse(upstream: globalThis.Response): Promise<unknown> {
  if (!upstream.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await upstream.body?.cancel();
    throw new SupportError(502, 'UAL did not return a chat response. Check that the URL points to a deployed UAL backend.');
  }
  const reader = upstream.body?.getReader();
  if (!reader) throw new SupportError(502, 'UAL returned an empty response.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SupportError(502, 'The UAL response was too large. Please ask a shorter question.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SupportError(502, 'UAL returned an invalid chat response.'); }
}

// Transport and timing injection are for deterministic tests; HTTP clients cannot override them.
export function registerSupport(app: Express, publicOrigin: string, options: {
  fetch?: typeof fetch; ttlMs?: number; timeoutMs?: number;
} = {}) {
  const transport = options.fetch ?? fetch;
  const ttl = options.ttlMs ?? SESSION_TTL;
  const timeout = options.timeoutMs ?? 60000;
  const connections = new Map<string, Connection>();
  const cookie = (token: string, age: number) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/support; Max-Age=${age}${publicOrigin.startsWith('https:') ? '; Secure' : ''}`;
  function idFrom(req: Request) {
    const token = String(req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return token ? digest(token) : '';
  }
  function remove(id: string) {
    const connection = connections.get(id);
    if (!connection) return;
    connection.controller?.abort();
    clearTimeout(connection.timer);
    connection.apiKey = '';
    connection.messages = [];
    connections.delete(id);
  }
  function current(req: Request) {
    const id = idFrom(req);
    const connection = connections.get(id);
    if (connection && connection.expiresAt <= Date.now()) { remove(id); return undefined; }
    return connection;
  }
  function summary(connection: Connection) {
    return { connected: true, endpoint: connection.endpoint, expiresAt: connection.expiresAt, messages: connection.messages };
  }
  app.use('/api/support', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.headers.origin !== publicOrigin) {
      res.status(403).json({ error: 'Request must come from the NilaPack website.' }); return;
    }
    next();
  });
  app.get('/api/support/connection', (req, res) => {
    const connection = current(req);
    res.json(connection ? summary(connection) : { connected: false, defaultUrl: DEFAULT_CHATBOT_URL });
  });
  app.post('/api/support/connect', (req, res) => {
    try {
      const endpoint = normalizeChatbotUrl(req.body?.chatbotUrl);
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      if (!/^[A-Za-z0-9_-]{20,512}$/.test(apiKey)) {
        throw new SupportError(400, 'Paste the full, unmasked API key copied from UAL. The dotted or masked preview will not work.');
      }
      for (const [id, entry] of connections) if (entry.expiresAt <= Date.now()) remove(id);
      const oldId = idFrom(req);
      if (connections.size >= MAX_CONNECTIONS && !connections.has(oldId)) throw new SupportError(503, 'Support is busy. Please try again later.');
      remove(oldId);
      const token = opaqueToken(), id = digest(token);
      const connection: Connection = {
        endpoint, apiKey, messages: [], expiresAt: Date.now() + ttl, busy: false,
        timer: setTimeout(() => remove(id), ttl),
      };
      connection.timer.unref();
      connections.set(id, connection);
      res.setHeader('Set-Cookie', cookie(token, Math.ceil(ttl / 1000)));
      // Saving a connection does not claim the key is valid or make a billable probe request.
      res.json(summary(connection));
    } catch (error) { respondError(res, error); }
  });
  app.post('/api/support/disconnect', (req, res) => {
    remove(idFrom(req));
    res.setHeader('Set-Cookie', cookie('', 0));
    res.json({ connected: false });
  });
  app.post('/api/support/reset', (req, res) => {
    const connection = current(req);
    if (!connection) { res.status(410).json({ error: 'Your support connection expired. Enter your URL and API key again.' }); return; }
    if (connection.busy) { res.status(409).json({ error: 'Wait for the current reply before starting a new chat.' }); return; }
    connection.messages = [];
    res.json(summary(connection));
  });
  app.post('/api/support/chat', async (req, res) => {
    const connection = current(req);
    if (!connection) { res.status(410).json({ error: 'Your support connection expired. Enter your URL and API key again.' }); return; }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 2000) { res.status(400).json({ error: 'Enter a message between 1 and 2,000 characters.' }); return; }
    if (connection.busy) { res.status(409).json({ error: 'Please wait for the current reply.' }); return; }
    connection.busy = true;
    const controller = new AbortController();
    connection.controller = controller;
    const abortOnClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abortOnClose);
    try {
      const response = await transport(connection.endpoint, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${connection.apiKey}` },
        body: JSON.stringify({ message, history: connection.messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })) }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new SupportError(502, 'UAL rejected the API key. Use Change connection and paste the full key for this bot.');
        if (response.status === 404) throw new SupportError(502, 'UAL could not find this chatbot. Publish or sync the bot in UAL and check its URL.');
        if (response.status === 429) throw new SupportError(503, 'UAL is rate-limiting requests. Please wait and try again.');
        if (response.status >= 300 && response.status < 400) throw new SupportError(502, 'UAL redirected the request. Use its direct chat endpoint; keys are never forwarded to redirects.');
        if (response.status === 503) throw new SupportError(503, 'The UAL chatbot is paused or unavailable. Check its status in UAL.');
        throw new SupportError(502, 'UAL could not answer this message. Check the bot configuration and try again.');
      }
      const data = await readChatResponse(response) as { reply?: unknown; citations?: unknown } | null;
      if (typeof data?.reply !== 'string' || !data.reply.trim() || data.reply.length > 16000) throw new SupportError(502, 'UAL returned an invalid or empty reply.');
      if (controller.signal.aborted || current(req) !== connection) throw new SupportError(410, 'Your support connection changed or expired. Please reconnect.');
      const redact = (value: string) => value.replaceAll(connection.apiKey, '[redacted]');
      const reply = redact(data.reply);
      const citations = Array.isArray(data.citations) ? data.citations.filter((x): x is string => typeof x === 'string').slice(0, 10).map(x => redact(x.slice(0, 500))) : [];
      // Only user-facing text leaves this proxy. UAL traces, tool arguments and credentials do not.
      connection.messages = [...connection.messages, { role: 'user', content: redact(message) }, { role: 'assistant', content: reply, citations }].slice(-40) as Turn[];
      res.json({ reply, citations });
    } catch (error) { respondError(res, error); }
    finally {
      connection.busy = false;
      connection.controller = undefined;
      res.off('close', abortOnClose);
    }
  });
  return { close: () => { for (const id of connections.keys()) remove(id); } };
}

function respondError(res: Response, error: unknown) {
  if (res.destroyed || res.headersSent) return;
  if (error instanceof SupportError) { res.status(error.status).json({ error: error.message }); return; }
  // Never relay upstream bodies or error.message: they can contain credentials/internal traces.
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'UAL took too long to reply or the connection ended. Please try again.' : 'Unable to reach UAL. Check your connection and the deployed chatbot URL.' });
}
