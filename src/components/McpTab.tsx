import React, { useState } from 'react';
import { Plus, RefreshCw, Trash2, Wrench } from 'lucide-react';
import type { McpConnection, McpTool, McpTransport } from '../types';

interface McpTabProps {
  mcps: McpConnection[];
  onAddMcp: (payload: {
    name: string;
    endpointUrl: string;
    transport: McpTransport;
    authHeaderName: string;
    authTokenRaw: string;
    tools: McpTool[];
  }) => Promise<void>;
  onUpdateMcp: (mcpId: string, patch: Pick<McpConnection, 'enabled' | 'tools' | 'status'>) => Promise<void>;
  onReplaceToken: (mcpId: string, authTokenRaw: string) => Promise<void>;
  onDeleteMcp: (mcpId: string) => Promise<void>;
}

export function McpTab({ mcps, onAddMcp, onUpdateMcp, onReplaceToken, onDeleteMcp }: McpTabProps) {
  const [name, setName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [transport, setTransport] = useState<McpTransport>('streamable_http');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authTokenRaw, setAuthTokenRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [tokenBusyId, setTokenBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [statusNotice, setStatusNotice] = useState('');

  const handleUseBuiltInDemo = () => {
    setName('Meridian Operations MCP (Built-in)');
    setEndpointUrl('/api/mcp/demo');
    setTransport('streamable_http');
    setAuthHeaderName('Authorization');
    setAuthTokenRaw('Bearer rm_demo_internal');
    setError('');
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatusNotice('');

    if (!endpointUrl.trim()) {
      setError('MCP server endpoint URL is required (e.g. https://mcp.company.com/rpc or /api/mcp/demo).');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/mcp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: endpointUrl.trim(),
          authHeaderName: authHeaderName.trim(),
          authToken: authTokenRaw.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to discover tools from MCP server.');
      }

      await onAddMcp({
        name: name.trim() || data.serverName || 'Connected MCP Server',
        endpointUrl: endpointUrl.trim(),
        transport,
        authHeaderName: authHeaderName.trim(),
        authTokenRaw: authTokenRaw.trim(),
        tools: data.tools ?? [],
      });

      setName('');
      setEndpointUrl('');
      setAuthTokenRaw('');
      setStatusNotice(`Connected and discovered ${(data.tools ?? []).length} MCP tools.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect to MCP server.');
    } finally {
      setBusy(false);
    }
  };

  const handleRediscover = async (mcp: McpConnection) => {
    setRefreshingId(mcp.id);
    setError('');
    try {
      const res = await fetch('/api/mcp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: mcp.endpointUrl,
          authHeaderName: mcp.authHeaderName,
          authToken: mcp.authTokenRaw,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rediscovery failed.');

      const existingToggleMap = new Map(mcp.tools.map((t) => [t.name, t.enabled]));
      const existingIdentityMap = new Map(mcp.tools.map((t) => [t.name, Boolean(t.requiresCustomerIdentity)]));
      const mergedTools: McpTool[] = (data.tools ?? []).map((t: McpTool) => ({
        ...t,
        enabled: existingToggleMap.has(t.name) ? Boolean(existingToggleMap.get(t.name)) : true,
        requiresCustomerIdentity: existingIdentityMap.get(t.name) ?? false,
      }));

      await onUpdateMcp(mcp.id, {
        enabled: mcp.enabled,
        status: 'connected',
        tools: mergedTools,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh MCP tools.');
      await onUpdateMcp(mcp.id, {
        enabled: mcp.enabled,
        status: 'error',
        tools: mcp.tools,
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleReplaceToken = async (mcp: McpConnection) => {
    const draft = (tokenDrafts[mcp.id] ?? '').trim();
    if (!draft) {
      setError('Enter the full auth header value (e.g. Bearer your_token) before updating.');
      return;
    }
    setTokenBusyId(mcp.id);
    setError('');
    try {
      const res = await fetch('/api/mcp/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: mcp.endpointUrl,
          authHeaderName: mcp.authHeaderName,
          authToken: draft,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The MCP server rejected this token.');

      const existingToggleMap = new Map(mcp.tools.map((t) => [t.name, t.enabled]));
      const existingIdentityMap = new Map(mcp.tools.map((t) => [t.name, Boolean(t.requiresCustomerIdentity)]));
      const mergedTools: McpTool[] = (data.tools ?? []).map((t: McpTool) => ({
        ...t,
        enabled: existingToggleMap.has(t.name) ? Boolean(existingToggleMap.get(t.name)) : true,
        requiresCustomerIdentity: existingIdentityMap.get(t.name) ?? false,
      }));

      await onReplaceToken(mcp.id, draft);
      await onUpdateMcp(mcp.id, {
        enabled: mcp.enabled,
        status: 'connected',
        tools: mergedTools,
      });
      setTokenDrafts((prev) => ({ ...prev, [mcp.id]: '' }));
      setStatusNotice('Token verified against the MCP server and pushed to the live runtime.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update token.');
    } finally {
      setTokenBusyId(null);
    }
  };

  const toggleTool = async (mcp: McpConnection, toolName: string) => {
    const nextTools = mcp.tools.map((t) =>
      t.name === toolName ? { ...t, enabled: !t.enabled } : t
    );
    await onUpdateMcp(mcp.id, {
      enabled: mcp.enabled,
      status: mcp.status,
      tools: nextTools,
    });
  };

  const toggleToolIdentity = async (mcp: McpConnection, toolName: string) => {
    const nextTools = mcp.tools.map((t) =>
      t.name === toolName ? { ...t, requiresCustomerIdentity: !t.requiresCustomerIdentity } : t
    );
    await onUpdateMcp(mcp.id, {
      enabled: mcp.enabled,
      status: mcp.status,
      tools: nextTools,
    });
  };

  const toggleServer = async (mcp: McpConnection) => {
    await onUpdateMcp(mcp.id, {
      enabled: !mcp.enabled,
      status: mcp.status,
      tools: mcp.tools,
    });
  };

  return (
    <div className="space-y-6">
      {/* Add MCP Server Form */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Connect MCP Server</h1>
            <p className="text-xs text-slate-500">
              Register Streamable HTTP or SSE Model Context Protocol servers. Enabled tools are exposed live to Gemini function calling.
            </p>
          </div>
          <button
            type="button"
            onClick={handleUseBuiltInDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap shrink-0"
          >
            <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
            Fill Built-in Demo MCP Server
          </button>
        </div>

        <form onSubmit={handleConnect} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
          {statusNotice && (
            <div className="p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
              {statusNotice}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="mcp-name" className="block text-xs font-medium text-slate-700">
                Server Label
              </label>
              <input
                id="mcp-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stripe Billing MCP or CRM Operations"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mcp-transport" className="block text-xs font-medium text-slate-700">
                Transport Protocol
              </label>
              <select
                id="mcp-transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value as McpTransport)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              >
                <option value="streamable_http">Streamable HTTP (JSON-RPC 2.0 POST)</option>
                <option value="sse">Server-Sent Events (SSE JSON-RPC)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mcp-endpoint" className="block text-xs font-medium text-slate-700">
              MCP Endpoint URL
            </label>
            <input
              id="mcp-endpoint"
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://mcp.yourcompany.com/v1 or /api/mcp/demo"
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="mcp-auth-header" className="block text-xs font-medium text-slate-700">
                Auth Header Name (optional)
              </label>
              <input
                id="mcp-auth-header"
                type="text"
                value={authHeaderName}
                onChange={(e) => setAuthHeaderName(e.target.value)}
                placeholder="Authorization or X-API-Key"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="mcp-auth-token" className="block text-xs font-medium text-slate-700">
                Auth Header Value (masked on storage)
              </label>
              <input
                id="mcp-auth-token"
                type="password"
                value={authTokenRaw}
                onChange={(e) => setAuthTokenRaw(e.target.value)}
                placeholder="Bearer your_mcp_token"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {busy ? 'Discovering Tools...' : 'Connect & Discover Tools'}
          </button>
        </form>
      </section>

      {/* Connected MCP Servers List */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          Connected MCP Servers ({mcps.length})
        </h2>

        {mcps.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            No MCP servers attached to this chatbot yet. Use the built-in Demo MCP Server above to test live tool discovery and execution.
          </div>
        ) : (
          mcps.map((mcp) => (
            <div key={mcp.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{mcp.name}</h3>
                    <span
                      className={`text-xs font-medium ${
                        mcp.status === 'connected'
                          ? 'text-emerald-700'
                          : mcp.status === 'error'
                          ? 'text-red-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {mcp.status === 'connected'
                        ? 'Connected'
                        : mcp.status === 'error'
                        ? 'Error'
                        : 'Disconnected'}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 mt-0.5 truncate">
                    {mcp.endpointUrl} · {mcp.transport === 'sse' ? 'SSE' : 'Streamable HTTP'} ·{' '}
                    {mcp.tools.filter((t) => t.enabled).length}/{mcp.tools.length} tools enabled
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRediscover(mcp)}
                    disabled={refreshingId === mcp.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${refreshingId === mcp.id ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    Refresh Tools
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleServer(mcp)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap ${
                      mcp.enabled
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {mcp.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteMcp(mcp.id)}
                    aria-label={`Remove ${mcp.name}`}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg border border-slate-200 hover:border-red-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="password"
                  value={tokenDrafts[mcp.id] ?? ''}
                  onChange={(e) => setTokenDrafts((prev) => ({ ...prev, [mcp.id]: e.target.value }))}
                  placeholder={`Replace auth token — saved: ${mcp.authTokenMasked || 'none'}`}
                  aria-label={`Replace auth token for ${mcp.name}`}
                  title="Tokens are held in runtime memory only; re-enter here after a server restart."
                  className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => handleReplaceToken(mcp)}
                  disabled={tokenBusyId === mcp.id}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
                >
                  {tokenBusyId === mcp.id ? 'Verifying…' : 'Update token'}
                </button>
              </div>

              <div className="px-6 py-2.5 bg-amber-50/60 border-b border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-700">Requires sign-in</span> restricts a tool to HMAC-verified customers
                (set the identity secret and login URL in Overview). Anonymous visitors can call ungated tools with this
                connection's API key — leave the gate off only for tools that expose non-sensitive data.
              </div>
              {mcp.tools.length === 0 ? (
                <div className="px-6 py-4 text-xs text-slate-500">
                  No tools exposed by this server.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {mcp.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="px-6 py-3.5 flex items-start justify-between gap-4 hover:bg-slate-50/70"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-xs font-mono font-semibold text-slate-900">
                          {tool.name}
                          {tool.requiresCustomerIdentity && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-sans font-medium text-[10px] align-middle">
                              sign-in gated
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-600">{tool.description}</p>
                      </div>
                      <div className="flex items-start gap-4 shrink-0 pt-0.5">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer" title="Only runs for customers verified via HMAC sign-in; anonymous visitors get a sign-in prompt instead">
                          <input
                            type="checkbox"
                            checked={Boolean(tool.requiresCustomerIdentity)}
                            onChange={() => toggleToolIdentity(mcp, tool.name)}
                            aria-label={`Require customer sign-in for ${tool.name}`}
                            className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span>Requires sign-in</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            onChange={() => toggleTool(mcp, tool.name)}
                            aria-label={`Toggle tool ${tool.name}`}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{tool.enabled ? 'Allowed' : 'Blocked'}</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
