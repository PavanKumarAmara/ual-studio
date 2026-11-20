import { readFileSync } from 'fs';
import type { BotRuntimeSnapshot, KnowledgeChunk, McpConnection, Project } from '../src/types.ts';

// Server-side Firestore reads use Application Default Credentials:
// on Cloud Run the attached service account, locally GOOGLE_APPLICATION_CREDENTIALS.
// Without credentials the loader stays disabled and the runtime behaves memory-only.
const credentialsAvailable = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.K_SERVICE || // set by Cloud Run
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIRESTORE_EMULATOR_HOST
);

let dbPromise: Promise<FirebaseFirestore.Firestore> | null = null;
let loaderDisabled = !credentialsAvailable;

// The portal writes to the named AI Studio database, not (default) — mirror src/lib/firebase.ts
function readAppletConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    return JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

async function getDb(): Promise<FirebaseFirestore.Firestore | null> {
  if (loaderDisabled) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      const cfg = readAppletConfig();
      const app =
        getApps()[0] ??
        initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || cfg.projectId || undefined });
      const databaseId = process.env.FIRESTORE_DATABASE_ID || cfg.firestoreDatabaseId;
      return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    })().catch((err) => {
      console.warn('Firestore runtime loader disabled:', err instanceof Error ? err.message : err);
      loaderDisabled = true;
      throw err;
    });
  }
  try {
    return await dbPromise;
  } catch {
    return null;
  }
}

function tsToIso(val: unknown): string {
  if (val && typeof (val as { toDate?: unknown }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export async function loadBotSnapshotFromFirestore(
  orgSlug: string,
  botSlug: string
): Promise<BotRuntimeSnapshot | null> {
  const db = await getDb();
  if (!db) return null;

  const orgSnap = await db.collection('organizations').where('slug', '==', orgSlug).limit(1).get();
  if (orgSnap.empty) return null;
  const orgDoc = orgSnap.docs[0];
  const orgData = orgDoc.data();

  const projSnap = await orgDoc.ref.collection('projects').where('slug', '==', botSlug).limit(1).get();
  if (projSnap.empty) return null;
  const projDoc = projSnap.docs[0];
  const p = projDoc.data();

  const project: Project = {
    id: projDoc.id,
    orgId: orgDoc.id,
    ownerId: String(p.ownerId ?? ''),
    name: String(p.name ?? ''),
    slug: String(p.slug ?? botSlug),
    description: String(p.description ?? ''),
    systemPrompt: String(p.systemPrompt ?? ''),
    knowledgeBrief: String(p.knowledgeBrief ?? ''),
    apiKey: String(p.apiKey ?? ''),
    identitySecret: String(p.identitySecret ?? ''),
    loginUrl: String(p.loginUrl ?? ''),
    status: p.status === 'paused' ? 'paused' : 'active',
    theme: p.theme,
    storePage: p.storePage ?? undefined,
    chunkCount: Number(p.chunkCount ?? 0),
    sourceCount: Number(p.sourceCount ?? 0),
    createdAt: tsToIso(p.createdAt),
    updatedAt: tsToIso(p.updatedAt),
  };

  const [chunkSnap, mcpSnap] = await Promise.all([
    projDoc.ref.collection('chunks').get(),
    projDoc.ref.collection('mcps').get(),
  ]);

  const chunks: KnowledgeChunk[] = chunkSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      orgId: orgDoc.id,
      projectId: projDoc.id,
      sourceId: String(x.sourceId ?? ''),
      ownerId: String(x.ownerId ?? ''),
      sourceName: String(x.sourceName ?? ''),
      content: String(x.content ?? ''),
      tokenEstimate: Number(x.tokenEstimate ?? 0),
      embedding: Array.isArray(x.embedding) ? x.embedding : [],
      createdAt: tsToIso(x.createdAt),
    };
  });

  const mcps: McpConnection[] = mcpSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      orgId: orgDoc.id,
      projectId: projDoc.id,
      ownerId: String(x.ownerId ?? ''),
      name: String(x.name ?? ''),
      endpointUrl: String(x.endpointUrl ?? ''),
      transport: x.transport === 'sse' ? 'sse' : 'streamable_http',
      authHeaderName: String(x.authHeaderName ?? ''),
      authTokenMasked: String(x.authTokenMasked ?? ''),
      enabled: Boolean(x.enabled),
      status: x.status === 'connected' ? 'connected' : x.status === 'error' ? 'error' : 'disconnected',
      tools: Array.isArray(x.tools) ? x.tools : [],
      createdAt: tsToIso(x.createdAt),
      updatedAt: tsToIso(x.updatedAt),
    };
  });

  return {
    orgSlug,
    orgName: String(orgData.name ?? orgSlug),
    project,
    chunks,
    mcps,
  };
}