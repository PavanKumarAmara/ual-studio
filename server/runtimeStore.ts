import type { BotRuntimeSnapshot, TraceLog } from '../src/types.ts';
import { loadBotSnapshotFromFirestore } from './firestoreRuntime.ts';
import {
  SEED_ORGANIZATIONS,
  SEED_PROJECTS,
  SEED_CHUNKS,
  SEED_MCPS,
  SEED_TRACES,
} from '../src/utils/seedData.ts';

// Registry is namespaced by org so identical bot slugs in different tenants
// can never overwrite each other.
const runtimeKey = (orgSlug: string, botSlug: string) => `${orgSlug}/${botSlug}`;

const botRegistry = new Map<string, BotRuntimeSnapshot>();
const runtimeTraces = new Map<string, TraceLog[]>();

// Firestore is the source of truth; the registry is a cache. Entries older than
// the TTL are refreshed so cold starts and multi-instance Cloud Run stay correct.
const SNAPSHOT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const loadedAt = new Map<string, number>();
const missedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<BotRuntimeSnapshot | undefined>>();
// Entries born from Firestore must disappear when their document is deleted;
// seed/demo and dashboard-synced entries survive a null lookup instead.
const firestoreOrigin = new Set<string>();

function initSeedRuntime() {
  for (const proj of SEED_PROJECTS) {
    const org = SEED_ORGANIZATIONS.find((o) => o.id === proj.orgId) ?? SEED_ORGANIZATIONS[0];
    const key = runtimeKey(org.slug, proj.slug);
    botRegistry.set(key, {
      orgSlug: org.slug,
      orgName: org.name,
      project: proj,
      chunks: SEED_CHUNKS.filter((c) => c.projectId === proj.id),
      mcps: SEED_MCPS.filter((m) => m.projectId === proj.id),
    });
    runtimeTraces.set(
      key,
      SEED_TRACES.filter((t) => t.projectId === proj.id)
    );
  }
}

initSeedRuntime();

export function syncBotSnapshot(snapshot: BotRuntimeSnapshot): void {
  const key = runtimeKey(snapshot.orgSlug, snapshot.project.slug);
  const existing = botRegistry.get(key);
  // Preserve in-memory unmasked MCP tokens if client only sent masked tokens
  const mergedMcps = snapshot.mcps.map((mcp) => {
    if (mcp.authTokenRaw) return mcp;
    const prev = existing?.mcps.find((m) => m.id === mcp.id);
    return prev?.authTokenRaw ? { ...mcp, authTokenRaw: prev.authTokenRaw } : mcp;
  });

  botRegistry.set(key, {
    ...snapshot,
    mcps: mergedMcps,
  });
  loadedAt.set(key, Date.now());
  missedAt.delete(key);

  if (!runtimeTraces.has(key)) {
    runtimeTraces.set(key, []);
  }
}

export function getBotByOrgAndSlug(orgSlug: string, botSlug: string): BotRuntimeSnapshot | undefined {
  return botRegistry.get(runtimeKey(orgSlug, botSlug));
}

export async function resolveBotSnapshot(
  orgSlug: string,
  botSlug: string
): Promise<BotRuntimeSnapshot | undefined> {
  const key = runtimeKey(orgSlug, botSlug);
  const cached = botRegistry.get(key);
  const age = Date.now() - (loadedAt.get(key) ?? 0);
  if (cached && age < SNAPSHOT_TTL_MS) return cached;

  const lastMiss = missedAt.get(key);
  if (!cached && lastMiss && Date.now() - lastMiss < MISS_TTL_MS) return undefined;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const load = (async () => {
    try {
      const fresh = await loadBotSnapshotFromFirestore(orgSlug, botSlug);
      if (fresh) {
        syncBotSnapshot(fresh);
        firestoreOrigin.add(key);
        return botRegistry.get(key);
      }
      missedAt.set(key, Date.now());
      if (firestoreOrigin.has(key)) {
        botRegistry.delete(key);
        loadedAt.delete(key);
        firestoreOrigin.delete(key);
        return undefined;
      }
      // Keep serving the last known snapshot (or seed demo) if Firestore has no record
      return cached;
    } catch (err) {
      console.warn(`Firestore snapshot load failed for ${key}:`, err instanceof Error ? err.message : err);
      return cached;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, load);
  return load;
}

export function listRuntimeBots(): Array<{ orgSlug: string; botSlug: string; name: string; status: string }> {
  return Array.from(botRegistry.values()).map((b) => ({
    orgSlug: b.orgSlug,
    botSlug: b.project.slug,
    name: b.project.name,
    status: b.project.status,
  }));
}

export function appendRuntimeTrace(orgSlug: string, botSlug: string, trace: TraceLog): void {
  const key = runtimeKey(orgSlug, botSlug);
  const existing = runtimeTraces.get(key) ?? [];
  const next = [trace, ...existing].slice(0, 100);
  runtimeTraces.set(key, next);
}

export function getRuntimeTraces(orgSlug: string, botSlug: string): TraceLog[] {
  return runtimeTraces.get(runtimeKey(orgSlug, botSlug)) ?? [];
}