import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, MessageCircle, Send, X } from 'lucide-react';
import './support.css';

type Message = { role: 'user' | 'assistant'; content: string; citations?: string[] };
type Connection = { connected: boolean; endpoint?: string; defaultUrl?: string; messages?: Message[] };
const DEFAULT_URL = 'https://ual-studio.ai.studio/api/v1/bots/customer-support-bot/chat';
class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/support/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Restart the NilaPack server to enable the support connection.');
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error || 'The support request failed.', response.status);
  return result as T;
}

export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [chatbotUrl, setChatbotUrl] = useState(DEFAULT_URL);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null);
  const operation = useRef(0);

  useEffect(() => {
    if (!open || connection !== null || busy) return;
    const controller = new AbortController();
    setChecking(true);
    request<Connection>('connection', undefined, controller.signal).then(result => {
      setConnection(result);
      setChatbotUrl(result.endpoint ?? result.defaultUrl ?? DEFAULT_URL);
      setMessages(result.messages ?? []);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to check the connection.');
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => () => { operation.current++; abort.current?.abort(); }, []);
  useEffect(() => {
    if (open && !checking) {
      if (connection?.connected) composer.current?.focus();
      else keyInput.current?.focus();
    }
  }, [open, checking, connection?.connected]);
  useEffect(() => {
    const area = scrollArea.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [messages, pendingMessage, error, open]);

  function closePanel() { setOpen(false); launcher.current?.focus(); }
  function begin() {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true); setError('');
    return { id: ++operation.current, signal: abort.current.signal };
  }
  function failure(err: unknown) {
    setError(err instanceof Error ? err.message : 'Unable to complete the request.');
    if (err instanceof RequestError && err.status === 410) {
      setConnection({ connected: false }); setMessages([]);
    }
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || checking) return;
    const apiKey = keyInput.current?.value.trim() ?? '';
    if (!/^[A-Za-z0-9_-]{20,512}$/.test(apiKey)) {
      setError('Paste the full, unmasked API key from UAL. The dotted preview will not work.'); return;
    }
    const { id, signal } = begin();
    try {
      const result = await request<Connection>('connect', { chatbotUrl, apiKey }, signal);
      if (id !== operation.current) return;
      if (keyInput.current) keyInput.current.value = '';
      setConnection(result); setMessages([]); setDraft('');
      setChatbotUrl(result.endpoint ?? chatbotUrl);
    } catch (err) { if (id === operation.current) failure(err); }
    finally { if (id === operation.current) setBusy(false); }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || checking) return;
    const { id, signal } = begin();
    setPendingMessage(message);
    try {
      const result = await request<{ reply: string; citations: string[] }>('chat', { message }, signal);
      if (id !== operation.current) return;
      setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: result.reply, citations: result.citations }].slice(-40) as Message[]);
      setDraft('');
    } catch (err) { if (id === operation.current) failure(err); }
    finally {
      if (id === operation.current) {
        setBusy(false); setPendingMessage('');
        requestAnimationFrame(() => composer.current?.focus());
      }
    }
  }
  async function changeConnection() {
    if (busy) return;
    const { id, signal } = begin();
    try {
      await request('disconnect', {}, signal);
      if (id === operation.current) { setConnection({ connected: false }); setMessages([]); setDraft(''); }
    } catch (err) { if (id === operation.current) failure(err); }
    finally { if (id === operation.current) setBusy(false); }
  }
  async function newChat() {
    if (busy) return;
    const { id, signal } = begin();
    try {
      await request('reset', {}, signal);
      if (id === operation.current) { setMessages([]); setDraft(''); }
    } catch (err) { if (id === operation.current) failure(err); }
    finally { if (id === operation.current) setBusy(false); }
  }

  return <div className="chat-placeholder">
    {open && <section id="nilapack-support" className="chat-setup support-panel" aria-label="NilaPack support" onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}>
      <div className="chat-setup-header">
        <span><MessageCircle size={18} /> NilaPack support</span>
        <button type="button" aria-label="Close support" onClick={closePanel}><X size={18} /></button>
      </div>
      {checking ? <div className="support-loading" role="status">Checking your connection…</div> : connection?.connected ? <>
        <div className="support-toolbar">
          <span>Powered by UAL</span>
          <button type="button" disabled={busy || messages.length === 0} onClick={newChat}>New chat</button>
          <button type="button" disabled={busy} onClick={changeConnection}>Change connection</button>
        </div>
        <div className="support-messages" ref={scrollArea} role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 && !pendingMessage && <div className="support-welcome">
            <span className="round-icon"><MessageCircle size={23} /></span>
            <h3>What can we help with?</h3>
            <p>Your connection is saved. Send a message to check the key and start chatting with your UAL bot.</p>
            <small>This connects the bot, not your NilaPack customer identity.</small>
          </div>}
          {messages.map((message, index) => <article key={index} className={`support-message ${message.role}`}>
            <span className="support-speaker">{message.role === 'user' ? 'You' : 'UAL assistant'}</span>
            <p>{message.content}</p>
            {message.citations && message.citations.length > 0 && <details className="support-sources"><summary>Sources ({message.citations.length})</summary><ul>{message.citations.map((source, i) => <li key={i}>{source}</li>)}</ul></details>}
          </article>)}
          {pendingMessage && <><article className="support-message user"><span className="support-speaker">You</span><p>{pendingMessage}</p></article><p className="support-thinking" role="status">UAL is thinking…</p></>}
        </div>
        {error && <div className="support-error" role="alert">{error}</div>}
        <form className="support-composer" onSubmit={send}>
          <label className="support-sr-only" htmlFor="support-message">Message</label>
          <input id="support-message" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask a question…" maxLength={2000} autoComplete="off" disabled={busy} required />
          <button type="submit" className="button" disabled={busy || !draft.trim()} aria-label="Send message"><Send size={18} /></button>
        </form>
        <p className="support-footnote">Replies come from your UAL bot. Check important details.</p>
      </> : <div className="chat-setup-body support-setup-body">
        <span className="round-icon"><MessageCircle size={25} /></span>
        <h3>Connect your UAL chatbot.</h3>
        <p>Paste your chatbot URL and its full API key to start a conversation.</p>
        <form className="support-connect-form" onSubmit={connect} autoComplete="off">
          <label htmlFor="support-chatbot-url">Chatbot URL</label>
          <input id="support-chatbot-url" type="url" value={chatbotUrl} onChange={event => setChatbotUrl(event.target.value)} maxLength={1000} spellCheck={false} autoCapitalize="none" aria-describedby="support-url-help" required disabled={busy} />
          <small id="support-url-help">REST Chat Endpoint or Hosted Customer Chat URL.</small>
          <label htmlFor="support-api-key">API key</label>
          <input id="support-api-key" ref={keyInput} type="password" placeholder="Paste the full key, not the masked preview" maxLength={512} autoComplete="off" spellCheck={false} autoCapitalize="none" required disabled={busy} aria-describedby="support-key-help" />
          <small id="support-key-help">The key is kept in NilaPack server memory for up to one hour, never in browser storage or a URL. Restarting the server or changing the connection removes it.</small>
          {error && <div className="support-error" role="alert">{error}</div>}
          <button type="submit" className="button full" disabled={busy}>{busy ? 'Saving connection…' : 'Submit'}<ArrowRight size={16} /></button>
        </form>
      </div>}
    </section>}
    <button ref={launcher} type="button" className="chat-launcher" aria-expanded={open} aria-controls="nilapack-support" onClick={() => open ? closePanel() : setOpen(true)}>
      {open ? <X size={21} /> : <MessageCircle size={21} />}<span>{open ? 'Close' : 'Need a little help?'}</span>
    </button>
  </div>;
}
