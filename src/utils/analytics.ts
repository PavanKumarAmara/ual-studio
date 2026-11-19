import type { TraceLog } from '../types';
import { tokenizeForSearch } from './retrieval';

export interface QuestionTopicBucket {
  topic: string;
  count: number;
  sharePct: number;
  avgLatencyMs: number;
  groundedPct: number;
  sampleQuery: string;
}

export interface FrictionSignal {
  traceId: string;
  query: string;
  reason: 'http_error' | 'ungrounded' | 'fallback_response';
  reasonLabel: string;
  channel: TraceLog['channel'];
  createdAt: string;
}

export interface BaselineRecommendation {
  area: 'Product' | 'Documentation' | 'Support Workflow' | 'Integration';
  title: string;
  detail: string;
  impact: 'High' | 'Medium';
}

export interface QuestionAnalyticsSummary {
  totalConversations: number;
  groundedResolutionRatePct: number;
  mcpAssistedRatePct: number;
  frictionRatePct: number;
  topTopics: QuestionTopicBucket[];
  frictionSignals: FrictionSignal[];
  recommendations: BaselineRecommendation[];
}

const FALLBACK_PHRASES = [
  'cannot find',
  'not in the provided',
  'no information',
  'do not have',
  "don't have",
  'unable to',
  'missing from',
  'not available in',
  'unauthorized',
];

const EXTRA_TOPIC_STOPWORDS = new Set([
  'tell',
  'give',
  'show',
  'need',
  'want',
  'help',
  'know',
  'check',
  'look',
  'find',
  'could',
  'would',
  'should',
  'there',
  'where',
  'when',
  'status',
  'details',
  'info',
  'information',
  'policy',
  'question',
]);

function titleCaseWord(word: string): string {
  if (!word) return '';
  if (/^[A-Z0-9_-]{3,}$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function extractPrimaryTopic(query: string): string {
  const tokens = tokenizeForSearch(query).filter(
    (t) => t.length >= 3 && !EXTRA_TOPIC_STOPWORDS.has(t) && !/^\d+$/.test(t)
  );
  if (tokens.length === 0) {
    const fallbackTokens = tokenizeForSearch(query);
    if (fallbackTokens.length === 0) return 'General Inquiry';
    return fallbackTokens.slice(0, 2).map(titleCaseWord).join(' ');
  }
  // Prefer non-ID descriptive keywords when available
  const descriptive = tokens.filter((t) => !/^[a-z]{2,4}-\d+$/i.test(t));
  const chosen = (descriptive.length > 0 ? descriptive : tokens).slice(0, 2);
  return chosen.map(titleCaseWord).join(' ');
}

export function detectFrictionReason(
  trace: TraceLog
): { reason: FrictionSignal['reason']; reasonLabel: string } | null {
  if (trace.statusCode >= 400) {
    return {
      reason: 'http_error',
      reasonLabel: `HTTP ${trace.statusCode} error`,
    };
  }

  const previewLower = trace.responsePreview.toLowerCase();
  if (FALLBACK_PHRASES.some((phrase) => previewLower.includes(phrase))) {
    return {
      reason: 'fallback_response',
      reasonLabel: 'Uncertain or fallback reply',
    };
  }

  if (trace.citations.length === 0 && trace.mcpCalls.length === 0) {
    return {
      reason: 'ungrounded',
      reasonLabel: 'No knowledge source or MCP tool matched',
    };
  }

  return null;
}

export function computeQuestionAnalytics(traces: TraceLog[]): QuestionAnalyticsSummary {
  if (traces.length === 0) {
    return {
      totalConversations: 0,
      groundedResolutionRatePct: 0,
      mcpAssistedRatePct: 0,
      frictionRatePct: 0,
      topTopics: [],
      frictionSignals: [],
      recommendations: [],
    };
  }

  const frictionSignals: FrictionSignal[] = [];
  let groundedCount = 0;
  let mcpAssistedCount = 0;

  const topicMap = new Map<
    string,
    {
      count: number;
      latencySum: number;
      groundedCount: number;
      sampleQuery: string;
    }
  >();

  for (const trace of traces) {
    const friction = detectFrictionReason(trace);
    if (friction) {
      frictionSignals.push({
        traceId: trace.id,
        query: trace.query,
        reason: friction.reason,
        reasonLabel: friction.reasonLabel,
        channel: trace.channel,
        createdAt: trace.createdAt,
      });
    }

    const isGrounded =
      trace.statusCode < 400 && (trace.citations.length > 0 || trace.mcpCalls.length > 0);
    if (isGrounded) groundedCount += 1;
    if (trace.mcpCalls.length > 0) mcpAssistedCount += 1;

    const topic = extractPrimaryTopic(trace.query);
    const bucket = topicMap.get(topic) ?? {
      count: 0,
      latencySum: 0,
      groundedCount: 0,
      sampleQuery: trace.query,
    };
    bucket.count += 1;
    bucket.latencySum += trace.latencyMs;
    if (isGrounded) bucket.groundedCount += 1;
    topicMap.set(topic, bucket);
  }

  const topTopics: QuestionTopicBucket[] = Array.from(topicMap.entries())
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      sharePct: Math.round((data.count / traces.length) * 100),
      avgLatencyMs: Math.round(data.latencySum / data.count),
      groundedPct: Math.round((data.groundedCount / data.count) * 100),
      sampleQuery: data.sampleQuery,
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 6);

  const groundedResolutionRatePct = Math.round((groundedCount / traces.length) * 100);
  const mcpAssistedRatePct = Math.round((mcpAssistedCount / traces.length) * 100);
  const frictionRatePct = Math.round((frictionSignals.length / traces.length) * 100);

  const recommendations: BaselineRecommendation[] = [];

  const ungroundedSignals = frictionSignals.filter(
    (s) => s.reason === 'ungrounded' || s.reason === 'fallback_response'
  );
  if (ungroundedSignals.length > 0) {
    recommendations.push({
      area: 'Documentation',
      title: `Close ${ungroundedSignals.length} unanswered knowledge gap${ungroundedSignals.length > 1 ? 's' : ''}`,
      detail: `Customers asked "${ungroundedSignals[0].query.slice(0, 90)}" without matching indexed chunks. Upload an FAQ or connect the backing Postgres/S3 source covering this topic.`,
      impact: 'High',
    });
  }

  const httpErrors = frictionSignals.filter((s) => s.reason === 'http_error');
  if (httpErrors.length > 0) {
    recommendations.push({
      area: 'Integration',
      title: `Resolve ${httpErrors.length} API or endpoint error${httpErrors.length > 1 ? 's' : ''}`,
      detail: `Detected failed calls (${httpErrors[0].reasonLabel}). Verify client Bearer keys and upstream MCP timeouts in your integration layer.`,
      impact: 'High',
    });
  }

  if (topTopics.length > 0) {
    const leadTopic = topTopics[0];
    recommendations.push({
      area: 'Product',
      title: `Prioritize self-service UX around "${leadTopic.topic}"`,
      detail: `"${leadTopic.topic}" represents ${leadTopic.sharePct}% of observed customer questions (e.g., "${leadTopic.sampleQuery.slice(0, 80)}"). Surface proactive guidance in your product UI or starter prompts.`,
      impact: leadTopic.sharePct >= 35 ? 'High' : 'Medium',
    });
  }

  if (mcpAssistedCount > 0) {
    recommendations.push({
      area: 'Support Workflow',
      title: 'Expand live MCP tool coverage for repetitive lookups',
      detail: `${mcpAssistedRatePct}% of requests already triggered live MCP tools. Adding write-safe status or ticket actions can further deflect manual agent escalations.`,
      impact: 'Medium',
    });
  }

  return {
    totalConversations: traces.length,
    groundedResolutionRatePct,
    mcpAssistedRatePct,
    frictionRatePct,
    topTopics,
    frictionSignals: frictionSignals.slice(0, 8),
    recommendations: recommendations.slice(0, 4),
  };
}
