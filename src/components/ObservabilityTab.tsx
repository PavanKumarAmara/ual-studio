import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProductInsightReport, Project, TraceChannel, TraceLog } from '../types';
import { computeObservabilityMetrics } from '../utils/retrieval';
import { computeQuestionAnalytics } from '../utils/analytics';

interface ObservabilityTabProps {
  project: Project;
  traces: TraceLog[];
  refreshing: boolean;
  onRefresh: () => void;
}

type ObservabilityView = 'telemetry' | 'insights';

export function ObservabilityTab({
  project,
  traces,
  refreshing,
  onRefresh,
}: ObservabilityTabProps) {
  const [view, setView] = useState<ObservabilityView>('telemetry');
  const [channelFilter, setChannelFilter] = useState<'all' | TraceChannel>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(traces[0]?.id ?? null);

  const [aiReport, setAiReport] = useState<ProductInsightReport | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState('');

  const filteredTraces = useMemo(() => {
    return traces.filter((t) => {
      if (channelFilter !== 'all' && t.channel !== channelFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.query.toLowerCase().includes(q) ||
          t.responsePreview.toLowerCase().includes(q) ||
          t.citations.some((c) => c.toLowerCase().includes(q)) ||
          t.mcpCalls.some((m) => m.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [traces, channelFilter, searchQuery]);

  const metrics = useMemo(() => computeObservabilityMetrics(filteredTraces), [filteredTraces]);
  const questionAnalytics = useMemo(() => computeQuestionAnalytics(traces), [traces]);

  const selectedTrace =
    filteredTraces.find((t) => t.id === selectedTraceId) ?? filteredTraces[0] ?? null;

  const handleGenerateAiInsights = async () => {
    if (traces.length === 0) return;
    setGeneratingReport(true);
    setReportError('');
    try {
      const res = await fetch('/api/analytics/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: project.name,
          knowledgeBrief: project.knowledgeBrief,
          traces: traces.slice(0, 40).map((t) => ({
            query: t.query,
            responsePreview: t.responsePreview,
            citations: t.citations,
            mcpCalls: t.mcpCalls,
            statusCode: t.statusCode,
            channel: t.channel,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to synthesize product insights.');
      }
      setAiReport(data as ProductInsightReport);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Unable to generate insights.');
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-View Switcher */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Embedded Observability &amp; Customer Insights
            </h1>
            <p className="text-xs text-slate-500">
              Monitor live service telemetry and analyze what customers are asking to improve your product and documentation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              role="tablist"
              aria-label="Observability views"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === 'telemetry'}
                onClick={() => setView('telemetry')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  view === 'telemetry'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Telemetry &amp; Traces
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'insights'}
                onClick={() => setView('insights')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  view === 'insights'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Customer Insights &amp; Improvements
              </button>
            </div>

            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Telemetry
            </button>
          </div>
        </div>

        {view === 'telemetry' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 pt-5">
            <div>
              <p className="text-xs text-slate-500">Requests</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.totalRequests}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg Latency</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.avgLatencyMs}ms
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">P95 Latency</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.p95LatencyMs}ms
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Tokens</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.totalTokens.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">MCP Tool Calls</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {metrics.totalMcpCalls}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Error Rate</p>
              <p
                className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${
                  metrics.errorRatePct > 5 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {metrics.errorRatePct}%
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-5">
            <div>
              <p className="text-xs text-slate-500">Conversations Analyzed</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {questionAnalytics.totalConversations}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Grounded Self-Service Rate</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
                {questionAnalytics.groundedResolutionRatePct}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Live MCP-Assisted Rate</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                {questionAnalytics.mcpAssistedRatePct}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Knowledge Gap / Friction Rate</p>
              <p
                className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${
                  questionAnalytics.frictionRatePct > 15 ? 'text-amber-700' : 'text-slate-900'
                }`}
              >
                {questionAnalytics.frictionRatePct}%
              </p>
            </div>
          </div>
        )}
      </section>

      {view === 'telemetry' ? (
        <>
          {/* Latency Chart */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">End-to-End Request Latency (ms)</h2>
              <span className="text-xs text-slate-500 font-mono">
                Last {metrics.latencySeries.length} traces
              </span>
            </div>
            {metrics.latencySeries.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-slate-500">
                Send a request via the Live Playground, Hosted URL, or API endpoint to populate telemetry charts.
              </div>
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.latencySeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis width={68} tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} unit="ms" />
                    <Tooltip
                      contentStyle={{
                        fontSize: '12px',
                        borderRadius: '8px',
                        border: '1px solid #E2E8F0',
                      }}
                    />
                    <Bar dataKey="latencyMs" name="Latency (ms)" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Trace Explorer + Detail Inspector */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                  {(['all', 'api', 'hosted', 'widget', 'playground'] as const).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannelFilter(ch)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        channelFilter === ch
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {ch === 'all' ? 'All' : ch.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    aria-label="Filter traces"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter traces..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {filteredTraces.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No request traces match the active filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                        <th className="py-2.5 px-5">Query</th>
                        <th className="py-2.5 px-3">Channel</th>
                        <th className="py-2.5 px-3 text-right">Latency</th>
                        <th className="py-2.5 px-3 text-right">Tokens</th>
                        <th className="py-2.5 px-5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {filteredTraces.map((trace) => {
                        const isSelected = selectedTrace?.id === trace.id;
                        return (
                          <tr
                            key={trace.id}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-3 px-5 max-w-[260px]">
                              <button
                                type="button"
                                onClick={() => setSelectedTraceId(trace.id)}
                                className="text-left font-medium text-slate-900 truncate block w-full"
                              >
                                {trace.query}
                              </button>
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                              {trace.channel}
                            </td>
                            <td className="py-3 px-3 font-mono tabular-nums text-slate-700 text-right whitespace-nowrap">
                              {trace.latencyMs}ms
                            </td>
                            <td className="py-3 px-3 font-mono tabular-nums text-slate-700 text-right whitespace-nowrap">
                              {trace.promptTokens + trace.completionTokens}
                            </td>
                            <td className="py-3 px-5 font-mono tabular-nums text-right whitespace-nowrap">
                              <span
                                className={
                                  trace.statusCode >= 400
                                    ? 'text-red-600 font-semibold'
                                    : 'text-emerald-700 font-semibold'
                                }
                              >
                                {trace.statusCode}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Trace Inspector */}
            <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-200 pb-3">
                Trace Inspector
              </h2>

              {!selectedTrace ? (
                <p className="text-xs text-slate-500">Select a trace row to inspect citations and MCP calls.</p>
              ) : (
                <div className="space-y-4 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-500 font-mono tabular-nums">
                    <span
                      className={
                        selectedTrace.statusCode >= 400
                          ? 'text-red-600 font-semibold'
                          : 'text-emerald-700 font-semibold'
                      }
                    >
                      HTTP {selectedTrace.statusCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedTrace.latencyMs}ms</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {selectedTrace.promptTokens} in / {selectedTrace.completionTokens} out
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(selectedTrace.createdAt).toLocaleTimeString()}</span>
                  </div>

                  <div className="space-y-1">
                    <p className="font-medium text-slate-500">User Prompt</p>
                    <p className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 whitespace-pre-wrap">
                      {selectedTrace.query}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="font-medium text-slate-500">Model Response</p>
                    <p className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {selectedTrace.responsePreview}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="font-medium text-slate-500">Retrieved Knowledge Citations</p>
                    {selectedTrace.citations.length === 0 ? (
                      <p className="text-slate-400">No knowledge chunks cited.</p>
                    ) : (
                      <ul className="space-y-1 text-slate-700 font-mono">
                        {selectedTrace.citations.map((c, idx) => (
                          <li key={idx} className="truncate">
                            {idx + 1}. {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="font-medium text-slate-500">MCP Tool Executions</p>
                    {selectedTrace.mcpCalls.length === 0 ? (
                      <p className="text-slate-400">No external MCP tools invoked.</p>
                    ) : (
                      <ul className="space-y-1 text-blue-700 font-mono">
                        {selectedTrace.mcpCalls.map((call, idx) => (
                          <li key={idx} className="break-all">
                            {idx + 1}. {call}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        /* Customer Insights & Product Improvement View */
        <div className="space-y-6">
          {/* AI Product Improvement Synthesis */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Product &amp; Service Improvement Report
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Synthesize customer conversations into prioritized product, documentation, and workflow improvements.
                </p>
              </div>
              <button
                type="button"
                disabled={generatingReport || traces.length === 0}
                onClick={handleGenerateAiInsights}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {generatingReport ? 'Analyzing Conversations...' : 'Generate AI Product Insights'}
              </button>
            </div>

            {reportError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {reportError}
              </div>
            )}

            {traces.length === 0 ? (
              <p className="text-sm text-slate-500">
                No conversations recorded yet. Test your chatbot in the Live Playground or Hosted URL to generate customer question analytics and product recommendations.
              </p>
            ) : aiReport ? (
              <div className="space-y-6">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-900">Executive Summary</span>
                    <span className="font-mono">
                      {aiReport.analyzedTraceCount} traces analyzed ·{' '}
                      {new Date(aiReport.generatedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{aiReport.executiveSummary}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Prioritized Product & Service Improvements */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Recommended Product &amp; Service Improvements
                    </h3>
                    <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                      {aiReport.productImprovements.map((item, idx) => (
                        <div key={idx} className="p-4 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-blue-700">{item.area}</span>
                            <span
                              className={`font-mono ${
                                item.impact === 'High' ? 'text-amber-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              {item.impact} Impact
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-600 leading-relaxed">{item.rationale}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Knowledge Gaps & Customer Themes */}
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <h3 className="text-xs font-semibold text-slate-900">Detected Knowledge Gaps</h3>
                      {aiReport.knowledgeGaps.length === 0 ? (
                        <p className="text-xs text-slate-500">No major knowledge gaps detected in recent traces.</p>
                      ) : (
                        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                          {aiReport.knowledgeGaps.map((gap, idx) => (
                            <div key={idx} className="p-3.5 space-y-1 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900">{gap.gap}</span>
                                <span className="text-slate-500 font-mono shrink-0">{gap.frequencyHint}</span>
                              </div>
                              <p className="text-slate-600">
                                Suggested source: <span className="font-medium text-slate-800">{gap.suggestedSource}</span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-xs font-semibold text-slate-900">AI-Clustered Question Themes</h3>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {aiReport.topThemes.map((theme, idx) => (
                          <div key={idx} className="p-3.5 space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">{theme.topic}</span>
                              <span className="font-mono tabular-nums text-slate-500">
                                {theme.questionCount} asks · {theme.sentiment}
                              </span>
                            </div>
                            <p className="text-slate-600 truncate">&ldquo;{theme.sampleQuestion}&rdquo;</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Deterministic Baseline Recommendations shown immediately */
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Instant baseline findings from your recorded traces. Click &ldquo;Generate AI Product Insights&rdquo; for deep theme clustering and roadmap rationale.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {questionAnalytics.recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-blue-700">{rec.area}</span>
                        <span className="font-mono text-slate-500">{rec.impact} Impact</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                      <p className="text-xs text-slate-600 leading-relaxed">{rec.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Bottom Split: What Customers Are Asking + Friction Signals */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">What Customers Are Asking</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically grouped by primary intent across API, hosted URL, widget, and playground channels.
                </p>
              </div>

              {questionAnalytics.topTopics.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No customer questions recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                        <th className="py-2.5 px-5">Topic &amp; Sample Question</th>
                        <th className="py-2.5 px-3 text-right">Asks</th>
                        <th className="py-2.5 px-3 text-right">Share</th>
                        <th className="py-2.5 px-5 text-right">Grounded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {questionAnalytics.topTopics.map((bucket) => (
                        <tr key={bucket.topic}>
                          <td className="py-3 px-5 max-w-[300px]">
                            <p className="font-semibold text-slate-900">{bucket.topic}</p>
                            <p className="text-slate-500 truncate mt-0.5">{bucket.sampleQuery}</p>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                            {bucket.count}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                            {bucket.sharePct}%
                          </td>
                          <td className="py-3 px-5 text-right font-mono tabular-nums">
                            <span
                              className={
                                bucket.groundedPct >= 80
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-amber-700 font-semibold'
                              }
                            >
                              {bucket.groundedPct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-sm font-semibold text-slate-900">Knowledge Gaps &amp; Friction Signals</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Questions that returned errors, fallback replies, or zero matched knowledge sources.
                </p>
              </div>

              {questionAnalytics.frictionSignals.length === 0 ? (
                <p className="text-xs text-slate-500">
                  All recorded conversations were answered with grounded citations or live MCP tools.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 text-xs">
                  {questionAnalytics.frictionSignals.map((sig) => (
                    <div key={sig.traceId} className="py-3 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="text-amber-700 font-medium">{sig.reasonLabel}</span>
                        <span className="text-slate-400">{sig.channel}</span>
                      </div>
                      <p className="text-slate-800 font-medium">{sig.query}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
