import type { ChatTurnMessage, CustomerConversationThread } from '../types';

export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
export const MAX_STORED_THREADS = 25;
export const MAX_MESSAGES_PER_THREAD = 60;

export function buildHistoryStorageKey(
  orgSlug: string,
  botSlug: string,
  customerScope?: string | null
): string {
  const safeOrg = orgSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'org';
  const safeBot = botSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'bot';
  const safeCustomer = (customerScope ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_@.-]/g, '_')
    .slice(0, 64);
  return `ual_history:v1:${safeOrg}:${safeBot}:${safeCustomer || 'visitor'}`;
}

export function deriveThreadTitle(messages: ChatTurnMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim().length > 0);
  if (!firstUser) return 'New conversation';
  const singleLine = firstUser.content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 56) return singleLine;
  return `${singleLine.slice(0, 53).trimEnd()}...`;
}

export function createThreadId(): string {
  return `thr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function pruneExpiredThreads(
  threads: CustomerConversationThread[],
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
  nowMs = Date.now()
): CustomerConversationThread[] {
  const clampedDays = Math.min(365, Math.max(1, Math.round(Number(retentionDays) || DEFAULT_HISTORY_RETENTION_DAYS)));
  const cutoffMs = nowMs - clampedDays * 24 * 60 * 60 * 1000;

  return threads
    .filter((t) => {
      if (!t || typeof t.id !== 'string' || !Array.isArray(t.messages)) return false;
      const updatedMs = new Date(t.updatedAt).getTime();
      if (Number.isNaN(updatedMs)) return false;
      return updatedMs >= cutoffMs;
    })
    .map((t) => ({
      ...t,
      title: (t.title || deriveThreadTitle(t.messages)).slice(0, 80),
      messages: t.messages.slice(-MAX_MESSAGES_PER_THREAD),
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_STORED_THREADS);
}

export function upsertConversationThread(
  threads: CustomerConversationThread[],
  incoming: CustomerConversationThread,
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS,
  nowMs = Date.now()
): CustomerConversationThread[] {
  const normalized: CustomerConversationThread = {
    ...incoming,
    title: deriveThreadTitle(incoming.messages),
    updatedAt: incoming.updatedAt || new Date(nowMs).toISOString(),
    messages: incoming.messages.slice(-MAX_MESSAGES_PER_THREAD),
  };
  const withoutExisting = threads.filter((t) => t.id !== normalized.id);
  return pruneExpiredThreads([normalized, ...withoutExisting], retentionDays, nowMs);
}

export function deleteConversationThread(
  threads: CustomerConversationThread[],
  threadId: string
): CustomerConversationThread[] {
  return threads.filter((t) => t.id !== threadId);
}

export function formatRelativeThreadTime(isoDate: string, nowMs = Date.now()): string {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function loadCustomerThreads(
  storageKey: string,
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS
): CustomerConversationThread[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneExpiredThreads(parsed as CustomerConversationThread[], retentionDays);
  } catch {
    return [];
  }
}

export function saveCustomerThreads(
  storageKey: string,
  threads: CustomerConversationThread[],
  retentionDays = DEFAULT_HISTORY_RETENTION_DAYS
): void {
  if (typeof window === 'undefined') return;
  try {
    const pruned = pruneExpiredThreads(threads, retentionDays);
    window.localStorage.setItem(storageKey, JSON.stringify(pruned));
  } catch {
    // Storage unavailable (e.g. strict third-party iframe sandbox)
  }
}

export function clearCustomerThreads(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage errors
  }
}
