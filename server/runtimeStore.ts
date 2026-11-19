import type { BotRuntimeSnapshot, TraceLog } from '../src/types';
import {
  SEED_ORGANIZATIONS,
  SEED_PROJECTS,
  SEED_CHUNKS,
  SEED_MCPS,
  SEED_TRACES,
} from '../src/utils/seedData';

const botRegistry = new Map<string, BotRuntimeSnapshot>();
const runtimeTraces = new Map<string, TraceLog[]>();

function initSeedRuntime() {
  for (const proj of SEED_PROJECTS) {
    const org = SEED_ORGANIZATIONS.find((o) => o.id === proj.orgId) ?? SEED_ORGANIZATIONS[0];
    botRegistry.set(proj.slug, {
      orgSlug: org.slug,
      orgName: org.name,
      project: proj,
      chunks: SEED_CHUNKS.filter((c) => c.projectId === proj.id),
      mcps: SEED_MCPS.filter((m) => m.projectId === proj.id),
    });
    runtimeTraces.set(
      proj.slug,
      SEED_TRACES.filter((t) => t.projectId === proj.id)
    );
  }
}

initSeedRuntime();

export function syncBotSnapshot(snapshot: BotRuntimeSnapshot): void {
  const existing = botRegistry.get(snapshot.project.slug);
  // Preserve in-memory unmasked MCP tokens if client only sent masked tokens
  const mergedMcps = snapshot.mcps.map((mcp) => {
    if (mcp.authTokenRaw) return mcp;
    const prev = existing?.mcps.find((m) => m.id === mcp.id);
    return prev?.authTokenRaw ? { ...mcp, authTokenRaw: prev.authTokenRaw } : mcp;
  });

  botRegistry.set(snapshot.project.slug, {
    ...snapshot,
    mcps: mergedMcps,
  });

  if (!runtimeTraces.has(snapshot.project.slug)) {
    runtimeTraces.set(snapshot.project.slug, []);
  }
}

export function getBotBySlug(botSlug: string): BotRuntimeSnapshot | undefined {
  return botRegistry.get(botSlug);
}

export function getBotByOrgAndSlug(orgSlug: string, botSlug: string): BotRuntimeSnapshot | undefined {
  const bot = botRegistry.get(botSlug);
  if (!bot) return undefined;
  if (bot.orgSlug === orgSlug) return bot;
  return undefined;
}

export function listRuntimeBots(): Array<{ orgSlug: string; botSlug: string; name: string; status: string }> {
  return Array.from(botRegistry.values()).map((b) => ({
    orgSlug: b.orgSlug,
    botSlug: b.project.slug,
    name: b.project.name,
    status: b.project.status,
  }));
}

export function appendRuntimeTrace(botSlug: string, trace: TraceLog): void {
  const existing = runtimeTraces.get(botSlug) ?? [];
  const next = [trace, ...existing].slice(0, 100);
  runtimeTraces.set(botSlug, next);
}

export function getRuntimeTraces(botSlug: string): TraceLog[] {
  return runtimeTraces.get(botSlug) ?? [];
}
