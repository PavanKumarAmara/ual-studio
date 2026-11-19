import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryStorageKey,
  deleteConversationThread,
  deriveThreadTitle,
  formatRelativeThreadTime,
  MAX_STORED_THREADS,
  pruneExpiredThreads,
  upsertConversationThread,
} from './customerHistory';
import type { CustomerConversationThread } from '../types';

test('buildHistoryStorageKey scopes keys by org, bot, and optional customer ID', () => {
  assert.equal(
    buildHistoryStorageKey('meridian-logistics', 'freight-support-bot'),
    'ual_history:v1:meridian-logistics:freight-support-bot:visitor'
  );
  assert.equal(
    buildHistoryStorageKey('Meridian-Logistics', 'Freight-Bot', 'acct_42@acme.com'),
    'ual_history:v1:meridian-logistics:freight-bot:acct_42@acme.com'
  );
});

test('deriveThreadTitle uses first user message and truncates long prompts cleanly', () => {
  assert.equal(deriveThreadTitle([]), 'New conversation');
  assert.equal(
    deriveThreadTitle([
      { role: 'assistant', content: 'Welcome!' },
      { role: 'user', content: 'What are EU customs clearance requirements?' },
    ]),
    'What are EU customs clearance requirements?'
  );
  const longPrompt =
    'Can you compare the annual Enterprise Cold-Chain SLA terms versus the Standard Commercial package for Rotterdam shipments?';
  const title = deriveThreadTitle([{ role: 'user', content: longPrompt }]);
  assert.ok(title.length <= 56);
  assert.ok(title.endsWith('...'));
});

test('pruneExpiredThreads removes threads older than retention window and caps count', () => {
  const now = new Date('2026-11-19T12:00:00Z').getTime();
  const recent: CustomerConversationThread = {
    id: 'thr_recent',
    title: 'Recent chat',
    createdAt: '2026-11-18T12:00:00Z',
    updatedAt: '2026-11-18T12:00:00Z',
    messages: [{ role: 'user', content: 'Recent chat' }],
  };
  const expired: CustomerConversationThread = {
    id: 'thr_expired',
    title: 'Old chat',
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    messages: [{ role: 'user', content: 'Old chat' }],
  };

  const kept = pruneExpiredThreads([expired, recent], 7, now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, 'thr_recent');

  const many: CustomerConversationThread[] = Array.from({ length: 35 }, (_, i) => ({
    id: `thr_${i}`,
    title: `Thread ${i}`,
    createdAt: new Date(now - i * 60_000).toISOString(),
    updatedAt: new Date(now - i * 60_000).toISOString(),
    messages: [{ role: 'user', content: `Thread ${i}` }],
  }));
  const capped = pruneExpiredThreads(many, 30, now);
  assert.equal(capped.length, MAX_STORED_THREADS);
  assert.equal(capped[0].id, 'thr_0');
});

test('upsertConversationThread updates existing thread in place and moves it to top', () => {
  const now = new Date('2026-11-19T12:00:00Z').getTime();
  const initial: CustomerConversationThread[] = [
    {
      id: 'thr_1',
      title: 'First question',
      createdAt: '2026-11-19T10:00:00Z',
      updatedAt: '2026-11-19T10:00:00Z',
      messages: [{ role: 'user', content: 'First question' }],
    },
    {
      id: 'thr_2',
      title: 'Second question',
      createdAt: '2026-11-19T11:00:00Z',
      updatedAt: '2026-11-19T11:00:00Z',
      messages: [{ role: 'user', content: 'Second question' }],
    },
  ];

  const updated = upsertConversationThread(
    initial,
    {
      id: 'thr_1',
      title: 'First question',
      createdAt: '2026-11-19T10:00:00Z',
      updatedAt: '2026-11-19T11:55:00Z',
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ],
    },
    30,
    now
  );

  assert.equal(updated.length, 2);
  assert.equal(updated[0].id, 'thr_1');
  assert.equal(updated[0].messages.length, 2);

  const afterDelete = deleteConversationThread(updated, 'thr_1');
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, 'thr_2');
});

test('formatRelativeThreadTime formats recent and multi-day intervals', () => {
  const now = new Date('2026-11-19T12:00:00Z').getTime();
  assert.equal(formatRelativeThreadTime('2026-11-19T11:59:30Z', now), 'Just now');
  assert.equal(formatRelativeThreadTime('2026-11-19T11:45:00Z', now), '15m ago');
  assert.equal(formatRelativeThreadTime('2026-11-19T09:00:00Z', now), '3h ago');
  assert.equal(formatRelativeThreadTime('2026-11-17T12:00:00Z', now), '2d ago');
});
