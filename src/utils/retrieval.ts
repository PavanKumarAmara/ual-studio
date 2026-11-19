import type { KnowledgeChunk, TraceLog } from '../types';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'of', 'to', 'in', 'for',
  'with', 'as', 'by', 'are', 'be', 'this', 'that', 'it', 'from', 'or', 'we', 'our',
  'what', 'how', 'can', 'do', 'does', 'my', 'your', 'about', 'please',
]);

export function tokenizeForSearch(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function lexicalScore(query: string, doc: string): number {
  const qTokens = tokenizeForSearch(query);
  if (qTokens.length === 0) return 0;
  const docLower = doc.toLowerCase();
  const docTokens = new Set(tokenizeForSearch(doc));
  let matched = 0;
  for (const token of qTokens) {
    if (docTokens.has(token)) {
      matched += 1;
    } else if (docLower.includes(token)) {
      matched += 0.6;
    }
  }
  return matched / qTokens.length;
}

export function rankChunks(
  query: string,
  queryEmbedding: number[],
  chunks: KnowledgeChunk[],
  topK = 5
): Array<{ chunk: KnowledgeChunk; score: number }> {
  const scored = chunks.map((chunk) => {
    const lex = lexicalScore(query, `${chunk.sourceName} ${chunk.content}`);
    const hasVec = queryEmbedding.length > 0 && chunk.embedding.length === queryEmbedding.length;
    const vec = hasVec ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding)) : 0;
    const combined = hasVec ? vec * 0.68 + lex * 0.32 : lex;
    return { chunk, score: Number(combined.toFixed(4)) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export interface ObservabilitySummary {
  totalRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalTokens: number;
  totalMcpCalls: number;
  errorRatePct: number;
  channelBreakdown: Array<{ channel: string; count: number }>;
  latencySeries: Array<{ label: string; latencyMs: number; tokens: number; status: number }>;
}

export function computeObservabilityMetrics(traces: TraceLog[]): ObservabilitySummary {
  if (traces.length === 0) {
    return {
      totalRequests: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      totalTokens: 0,
      totalMcpCalls: 0,
      errorRatePct: 0,
      channelBreakdown: [],
      latencySeries: [],
    };
  }

  const sortedLatencies = traces.map((t) => t.latencyMs).sort((a, b) => a - b);
  const sumLatency = sortedLatencies.reduce((acc, v) => acc + v, 0);
  const p95Index = Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95));
  const totalTokens = traces.reduce((acc, t) => acc + t.promptTokens + t.completionTokens, 0);
  const totalMcpCalls = traces.reduce((acc, t) => acc + t.mcpCalls.length, 0);
  const errorCount = traces.filter((t) => t.statusCode >= 400).length;

  const channelMap = new Map<string, number>();
  for (const t of traces) {
    channelMap.set(t.channel, (channelMap.get(t.channel) ?? 0) + 1);
  }

  const ordered = [...traces]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-14);

  const latencySeries = ordered.map((t, idx) => {
    const d = new Date(t.createdAt);
    const label = Number.isNaN(d.getTime())
      ? `#${idx + 1}`
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      label,
      latencyMs: Math.round(t.latencyMs),
      tokens: t.promptTokens + t.completionTokens,
      status: t.statusCode,
    };
  });

  return {
    totalRequests: traces.length,
    avgLatencyMs: Math.round(sumLatency / traces.length),
    p95LatencyMs: Math.round(sortedLatencies[p95Index]),
    totalTokens,
    totalMcpCalls,
    errorRatePct: Number(((errorCount / traces.length) * 100).toFixed(1)),
    channelBreakdown: Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })),
    latencySeries,
  };
}
