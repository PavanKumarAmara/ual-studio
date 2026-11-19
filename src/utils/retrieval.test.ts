import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, rankChunks, computeObservabilityMetrics } from './retrieval';
import type { KnowledgeChunk, TraceLog } from '../types';

test('cosineSimilarity computes exact similarity scores', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test('rankChunks prioritizes semantically and lexically relevant chunks', () => {
  const chunks: KnowledgeChunk[] = [
    {
      id: 'c1',
      orgId: 'o1',
      projectId: 'p1',
      sourceId: 's1',
      ownerId: 'u1',
      sourceName: 'customs-policy.md',
      content: 'EU customs clearance requires commercial invoice and HS tariff code 24 hours before arrival.',
      tokenEstimate: 20,
      embedding: [0.95, 0.05, 0],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'c2',
      orgId: 'o1',
      projectId: 'p1',
      sourceId: 's2',
      ownerId: 'u1',
      sourceName: 'office-hours.txt',
      content: 'Our Rotterdam warehouse is open Monday through Friday from 07:00 to 19:00 CET.',
      tokenEstimate: 18,
      embedding: [0.05, 0.95, 0],
      createdAt: new Date().toISOString(),
    },
  ];

  const ranked = rankChunks('What is required for EU customs clearance?', [0.96, 0.04, 0], chunks, 2);
  assert.equal(ranked[0].chunk.id, 'c1');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('computeObservabilityMetrics calculates latency percentiles, tokens, and error rate', () => {
  const base = Date.now();
  const traces: TraceLog[] = [
    {
      id: 't1', orgId: 'o1', projectId: 'p1', ownerId: 'u1',
      query: 'Track MRD-8841', responsePreview: 'In transit', latencyMs: 420,
      promptTokens: 310, completionTokens: 90, statusCode: 200, channel: 'api',
      citations: ['shipments (postgres)'], mcpCalls: ['lookup_shipment_status'],
      createdAt: new Date(base - 60000).toISOString(),
    },
    {
      id: 't2', orgId: 'o1', projectId: 'p1', ownerId: 'u1',
      query: 'Customs rules', responsePreview: 'Need HS code', latencyMs: 680,
      promptTokens: 450, completionTokens: 150, statusCode: 200, channel: 'hosted',
      citations: ['customs-policy.md'], mcpCalls: [],
      createdAt: new Date(base - 30000).toISOString(),
    },
    {
      id: 't3', orgId: 'o1', projectId: 'p1', ownerId: 'u1',
      query: 'Invalid request', responsePreview: 'Unauthorized', latencyMs: 100,
      promptTokens: 0, completionTokens: 0, statusCode: 401, channel: 'api',
      citations: [], mcpCalls: [],
      createdAt: new Date(base).toISOString(),
    },
  ];

  const summary = computeObservabilityMetrics(traces);
  assert.equal(summary.totalRequests, 3);
  assert.equal(summary.avgLatencyMs, 400);
  assert.equal(summary.p95LatencyMs, 680);
  assert.equal(summary.totalTokens, 1000);
  assert.equal(summary.totalMcpCalls, 1);
  assert.equal(summary.errorRatePct, 33.3);
});
