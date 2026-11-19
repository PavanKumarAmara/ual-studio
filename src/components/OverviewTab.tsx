import React, { useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
} from 'lucide-react';
import type { ChatTurnMessage, Organization, Project, TraceLog } from '../types';

interface OverviewTabProps {
  org: Organization;
  project: Project;
  mcpToolCount: number;
  traceCount: number;
  onRotateKey: () => Promise<void>;
  onSavePrompt: (systemPrompt: string, status: 'active' | 'paused') => Promise<void>;
  onRecordTrace: (trace: TraceLog) => void;
}

export function OverviewTab({
  org,
  project,
  mcpToolCount,
  traceCount,
  onRotateKey,
  onSavePrompt,
  onRecordTrace,
}: OverviewTabProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-service.run.app';
  const hostedUrl = `${origin}/c/${org.slug}/${project.slug}`;
  const apiEndpoint = `${origin}/api/v1/bots/${project.slug}/chat`;
  const embedScript = `<script src="${origin}/embed/${project.slug}.js" async></script>`;

  const [showKey, setShowKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [snippetLang, setSnippetLang] = useState<'curl' | 'node' | 'python'>('curl');
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt);
  const [status, setStatus] = useState<'active' | 'paused'>(project.status);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);

  // Quick live test state
  const [testInput, setTestInput] = useState('');
  const [testMessages, setTestMessages] = useState<ChatTurnMessage[]>([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  // Keep local form synced if user switches projects
  React.useEffect(() => {
    setSystemPrompt(project.systemPrompt);
    setStatus(project.status);
    setTestMessages([]);
    setTestError('');
  }, [project.id, project.systemPrompt, project.status]);

  const copyText = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(id);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSaveBehavior = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrompt(true);
    try {
      await onSavePrompt(systemPrompt, status);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleRotate = async () => {
    setRotatingKey(true);
    try {
      await onRotateKey();
    } finally {
      setRotatingKey(false);
    }
  };

  const sendPlaygroundPrompt = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean || testing) return;
    setTestError('');
    const nextHistory = [...testMessages, { role: 'user' as const, content: clean }];
    setTestMessages(nextHistory);
    setTestInput('');
    setTesting(true);

    try {
      const res = await fetch(`/api/v1/bots/${project.slug}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RelayMesh-Channel': 'playground',
        },
        body: JSON.stringify({
          message: clean,
          history: testMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.trace) {
        onRecordTrace(data.trace);
      }
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTestMessages([
        ...nextHistory,
        {
          role: 'assistant',
          content: data.reply,
          citations: data.citations ?? [],
          mcpCalls: data.mcpCalls ?? [],
          latencyMs: data.latencyMs,
          tokens: data.usage?.totalTokens ?? 0,
        },
      ]);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Endpoint request failed.');
    } finally {
      setTesting(false);
    }
  };

  const maskedKey = `${project.apiKey.slice(0, 14)}${'•'.repeat(20)}`;

  const snippets = {
    curl: `curl -X POST "${apiEndpoint}" \\
  -H "Authorization: Bearer ${showKey ? project.apiKey : 'YOUR_PROJECT_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "What are EU customs clearance requirements?"}'`,
    node: `const res = await fetch("${apiEndpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${showKey ? project.apiKey : 'YOUR_PROJECT_API_KEY'}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message: "Track shipment MRD-8841",
    history: [],
  }),
});
const data = await res.json();
console.log(data.reply, data.citations, data.mcpCalls);`,
    python: `import requests

resp = requests.post(
    "${apiEndpoint}",
    headers={"Authorization": "Bearer ${showKey ? project.apiKey : 'YOUR_PROJECT_API_KEY'}"},
    json={"message": "Track shipment MRD-8841", "history": []},
)
print(resp.json())`,
  };

  return (
    <div className="space-y-6">
      {/* Service Header & Tabular Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{project.name}</h1>
            <p className="text-sm text-slate-600 max-w-2xl">
              {project.description || 'Provisioned multi-tenant chatbot service with knowledge grounding and observability.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
              <span className={project.status === 'active' ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                {project.status === 'active' ? 'Active endpoint' : 'Paused'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">/{org.slug}/{project.slug}</span>
              <span aria-hidden="true">·</span>
              <span>Gemini 4 + Hybrid Vector RAG</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-5">
          <div>
            <p className="text-xs text-slate-500">Connected Sources</p>
            <p className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
              {project.sourceCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Indexed Knowledge Chunks</p>
            <p className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
              {project.chunkCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Active MCP Tools</p>
            <p className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
              {mcpToolCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Observed Requests</p>
            <p className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
              {traceCount}
            </p>
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace: Provisioned Endpoints + Live Endpoint Tester */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Endpoints, Key, Snippets, Prompt */}
        <div className="xl:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            <div className="p-5">
              <h2 className="text-base font-semibold text-slate-900">Provisioned Endpoints & Credentials</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Unique customer URLs and API key generated automatically for this service.
              </p>
            </div>

            {/* Live API Endpoint */}
            <div className="p-5 space-y-1.5">
              <span className="text-xs font-medium text-slate-600">REST Chat Endpoint (POST)</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {apiEndpoint}
                </code>
                <button
                  type="button"
                  onClick={() => copyText('api', apiEndpoint)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'api' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'api' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Hosted Customer Chat URL */}
            <div className="p-5 space-y-1.5">
              <span className="text-xs font-medium text-slate-600">Hosted Customer Chat URL</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {hostedUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyText('hosted', hostedUrl)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'hosted' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'hosted' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Embeddable Widget Snippet */}
            <div className="p-5 space-y-1.5">
              <span className="text-xs font-medium text-slate-600">Drop-in Website Widget Script</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {embedScript}
                </code>
                <button
                  type="button"
                  onClick={() => copyText('embed', embedScript)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'embed' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'embed' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Project API Key */}
            <div className="p-5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Scoped Service API Key</span>
                <button
                  type="button"
                  onClick={handleRotate}
                  disabled={rotatingKey}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${rotatingKey ? 'animate-spin' : ''}`} />
                  Rotate key
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 truncate">
                  {showKey ? project.apiKey : maskedKey}
                </code>
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={showKey ? 'Hide API key' : 'Reveal API key'}
                  className="p-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => copyText('key', project.apiKey)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copiedField === 'key' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'key' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Integration Snippets */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['curl', 'node', 'python'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setSnippetLang(lang)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        snippetLang === lang
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lang === 'curl' ? 'cURL' : lang === 'node' ? 'Node.js' : 'Python'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => copyText('snippet', snippets[snippetLang])}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  {copiedField === 'snippet' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'snippet' ? 'Copied snippet' : 'Copy snippet'}
                </button>
              </div>
              <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed">
                <code>{snippets[snippetLang]}</code>
              </pre>
            </div>
          </section>

          {/* System Behavior & Status */}
          <form onSubmit={handleSaveBehavior} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Service Instructions & State</h2>
                <p className="text-xs text-slate-500">Controls how Gemini grounds answers and calls MCP tools.</p>
              </div>
              <select
                aria-label="Service status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50 text-slate-800"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="overview-system-prompt" className="block text-xs font-medium text-slate-600">
                System Prompt
              </label>
              <textarea
                id="overview-system-prompt"
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-700">
                {savedNotice ? 'Configuration synced to live endpoint.' : ''}
              </span>
              <button
                type="submit"
                disabled={savingPrompt}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {savingPrompt ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </div>

        {/* Right 5 Columns: Live Endpoint Playground */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl flex flex-col h-[640px]">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Live Endpoint Playground</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Test RAG retrieval, Gemini grounding, and MCP tool execution directly. Every turn logs to Observability.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {testMessages.length === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">{project.theme.welcomeMessage}</p>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">Try a starter query</p>
                  <div className="flex flex-col gap-2">
                    {project.theme.starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => sendPlaygroundPrompt(prompt)}
                        className="text-left px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {testMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.content}
                </div>

                {msg.role === 'assistant' && (
                  <div className="mt-1.5 space-y-1 max-w-[90%]">
                    {(msg.latencyMs !== undefined || (msg.tokens ?? 0) > 0) && (
                      <p className="text-[11px] font-mono tabular-nums text-slate-500">
                        {msg.latencyMs}ms · {msg.tokens ?? 0} tokens
                      </p>
                    )}
                    {msg.citations && msg.citations.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Sources: {msg.citations.join(' · ')}
                      </p>
                    )}
                    {msg.mcpCalls && msg.mcpCalls.length > 0 && (
                      <div className="text-[11px] font-mono text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1.5 space-y-0.5">
                        {msg.mcpCalls.map((call, i) => (
                          <div key={i}>
                            MCP {call.toolName} ({call.durationMs}ms · {call.status})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {testing && (
              <div className="text-xs text-slate-500 font-mono">
                Querying knowledge index & MCP tools...
              </div>
            )}
            {testError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {testError}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendPlaygroundPrompt(testInput);
            }}
            className="p-4 border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Test chatbot message"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Ask about indexed docs or shipment MRD-8841..."
              className="flex-1 px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={testing || !testInput.trim()}
              aria-label="Send test message"
              className="inline-flex items-center justify-center px-3.5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
