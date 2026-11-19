import test from 'node:test';
import assert from 'node:assert/strict';
import type { TraceLog } from '../types';
import {
  computeQuestionAnalytics,
  detectFrictionReason,
  extractPrimaryTopic,
} from './analytics';

function makeTrace(overrides: Partial<TraceLog> = {}): TraceLog {
  return {
    id: `tr_${Math.random().toString(36).slice(2, 7)}`,
    orgId: 'org_1',
    projectId: 'proj_1',
    ownerId: 'user_1',
    query: 'How does cold-chain customs clearance work?',
    responsePreview: 'Cold-chain customs clearance requires temperature logs and commercial invoices.',
    latencyMs: 650,
    promptTokens: 320,
    completionTokens: 110,
    statusCode: 200,
    channel: 'hosted',
    citations: ['customs_sop.md'],
    mcpCalls: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('extractPrimaryTopic extracts readable descriptive keywords', () => {
  assert.equal(extractPrimaryTopic('What is the customs clearance requirement for Berlin?'), 'Customs Clearance');
  assert.equal(extractPrimaryTopic('Track shipment MRD-8841 please'), 'Track Shipment');
  assert.equal(extractPrimaryTopic('   '), 'General Inquiry');
});

test('detectFrictionReason flags HTTP errors, fallback phrases, and ungrounded turns', () => {
  const errTrace = makeTrace({ statusCode: 401, responsePreview: '401 Unauthorized' });
  assert.equal(detectFrictionReason(errTrace)?.reason, 'http_error');

  const fallbackTrace = makeTrace({
    statusCode: 200,
    responsePreview: 'I cannot find that pricing tier in our documents.',
    citations: ['pricing.md'],
  });
  assert.equal(detectFrictionReason(fallbackTrace)?.reason, 'fallback_response');

  const ungroundedTrace = makeTrace({
    statusCode: 200,
    citations: [],
    mcpCalls: [],
    responsePreview: 'Here is a generic answer.',
  });
  assert.equal(detectFrictionReason(ungroundedTrace)?.reason, 'ungrounded');

  const healthyTrace = makeTrace({
    statusCode: 200,
    citations: ['sla.md'],
    responsePreview: 'Enterprise SLA guarantees 99.9% uptime.',
  });
  assert.equal(detectFrictionReason(healthyTrace), null);
});

test('computeQuestionAnalytics computes resolution rate, topic buckets, and recommendations', () => {
  const traces: TraceLog[] = [
    makeTrace({ id: 't1', query: 'What are customs clearance rules?', citations: ['customs.md'] }),
    makeTrace({ id: 't2', query: 'Customs clearance paperwork for pharma?', citations: ['customs.md'] }),
    makeTrace({
      id: 't3',
      query: 'Track shipment MRD-8841',
      citations: [],
      mcpCalls: ['lookup_shipment_status({"id":"MRD-8841"}) · 32ms'],
    }),
    makeTrace({
      id: 't4',
      query: 'Do you support weekend rail freight in Spain?',
      citations: [],
      mcpCalls: [],
      responsePreview: 'This is missing from our connected knowledge sources.',
    }),
  ];

  const summary = computeQuestionAnalytics(traces);
  assert.equal(summary.totalConversations, 4);
  assert.equal(summary.groundedResolutionRatePct, 75);
  assert.equal(summary.mcpAssistedRatePct, 25);
  assert.equal(summary.frictionRatePct, 25);
  assert.equal(summary.topTopics[0].topic, 'Customs Clearance');
  assert.equal(summary.topTopics[0].count, 2);
  assert.equal(summary.frictionSignals.length, 1);
  assert.equal(summary.frictionSignals[0].traceId, 't4');
  assert.ok(summary.recommendations.some((r) => r.area === 'Documentation'));
  assert.ok(summary.recommendations.some((r) => r.area === 'Product'));
});
