import type { BotRuntimeSnapshot, TraceLog } from '../src/types.ts';
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

  if (!runtimeTraces.has(key)) {
    runtimeTraces.set(key, []);
  }
}

export function getBotByOrgAndSlug(orgSlug: string, botSlug: string): BotRuntimeSnapshot | undefined {
  return botRegistry.get(runtimeKey(orgSlug, botSlug));
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