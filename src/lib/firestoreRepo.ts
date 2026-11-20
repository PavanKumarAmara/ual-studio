import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  DataSource,
  KnowledgeChunk,
  McpConnection,
  Organization,
  Project,
  StorePage,
  TraceLog,
} from '../types';
import { normalizeVoiceName } from '../utils/voiceAudio';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function clampStr(val: string | undefined | null, max: number): string {
  return String(val ?? '').slice(0, max);
}

export async function fetchUserOrganizations(uid: string): Promise<Organization[]> {
  const path = 'organizations';
  try {
    const q = query(collection(db, path), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId),
        name: String(data.name),
        slug: String(data.slug),
        industry: String(data.industry ?? ''),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createOrganizationDoc(org: Organization): Promise<void> {
  const path = `organizations/${org.id}`;
  try {
    await setDoc(doc(db, 'organizations', org.id), {
      ownerId: clampStr(org.ownerId, 128),
      name: clampStr(org.name, 100),
      slug: clampStr(org.slug, 64),
      industry: clampStr(org.industry, 80),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchOrgProjects(orgId: string, uid: string): Promise<Project[]> {
  const path = `organizations/${orgId}/projects`;
  try {
    const q = query(collection(db, 'organizations', orgId, 'projects'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        orgId: String(data.orgId),
        ownerId: String(data.ownerId),
        name: String(data.name),
        slug: String(data.slug),
        description: String(data.description ?? ''),
        systemPrompt: String(data.systemPrompt ?? ''),
        knowledgeBrief: String(data.knowledgeBrief ?? ''),
        apiKey: String(data.apiKey ?? ''),
        identitySecret: String(data.identitySecret ?? ''),
        loginUrl: String(data.loginUrl ?? ''),
        hostedSignIn: data.hostedSignIn === true,
        storePage: data.storePage ?? undefined,
        status: data.status === 'paused' ? 'paused' : 'active',
        theme: {
          ...data.theme,
          enableCustomerHistory: data.theme?.enableCustomerHistory !== false,
          historyRetentionDays: Math.min(365, Math.max(1, Number(data.theme?.historyRetentionDays ?? 30))),
          enableVoiceMode: Boolean(data.theme?.enableVoiceMode),
          voiceName: normalizeVoiceName(data.theme?.voiceName),
        },
        chunkCount: Number(data.chunkCount ?? 0),
        sourceCount: Number(data.sourceCount ?? 0),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createProjectDoc(project: Project): Promise<void> {
  const path = `organizations/${project.orgId}/projects/${project.id}`;
  try {
    await setDoc(doc(db, 'organizations', project.orgId, 'projects', project.id), {
      orgId: clampStr(project.orgId, 128),
      ownerId: clampStr(project.ownerId, 128),
      name: clampStr(project.name, 100),
      slug: clampStr(project.slug, 64),
      description: clampStr(project.description, 500),
      systemPrompt: clampStr(project.systemPrompt, 4000),
      knowledgeBrief: clampStr(project.knowledgeBrief, 6000),
      apiKey: clampStr(project.apiKey, 120),
      identitySecret: clampStr(project.identitySecret, 120),
      loginUrl: clampStr(project.loginUrl, 500),
      status: project.status,
      theme: {
        primaryColor: clampStr(project.theme.primaryColor, 20),
        surfaceColor: clampStr(project.theme.surfaceColor, 20),
        textColor: clampStr(project.theme.textColor, 20),
        headerTitle: clampStr(project.theme.headerTitle, 80),
        subtitle: clampStr(project.theme.subtitle, 120),
        welcomeMessage: clampStr(project.theme.welcomeMessage, 500),
        position: project.theme.position,
        borderRadius: Math.min(24, Math.max(0, Number(project.theme.borderRadius ?? 12))),
        starterPrompts: (project.theme.starterPrompts ?? []).slice(0, 6).map((s) => clampStr(s, 140)),
        enableCustomerHistory: project.theme.enableCustomerHistory !== false,
        historyRetentionDays: Math.min(365, Math.max(1, Math.round(Number(project.theme.historyRetentionDays ?? 30)))),
        enableVoiceMode: Boolean(project.theme.enableVoiceMode),
        voiceName: normalizeVoiceName(project.theme.voiceName),
      },
      chunkCount: Math.max(0, Number(project.chunkCount ?? 0)),
      sourceCount: Math.max(0, Number(project.sourceCount ?? 0)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateProjectConfigDoc(
  orgId: string,
  projectId: string,
  patch: Pick<Project, 'name' | 'description' | 'systemPrompt' | 'theme' | 'status'>
): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'projects', projectId), {
      name: clampStr(patch.name, 100),
      description: clampStr(patch.description, 500),
      systemPrompt: clampStr(patch.systemPrompt, 4000),
      status: patch.status,
      theme: {
        primaryColor: clampStr(patch.theme.primaryColor, 20),
        surfaceColor: clampStr(patch.theme.surfaceColor, 20),
        textColor: clampStr(patch.theme.textColor, 20),
        headerTitle: clampStr(patch.theme.headerTitle, 80),
        subtitle: clampStr(patch.theme.subtitle, 120),
        welcomeMessage: clampStr(patch.theme.welcomeMessage, 500),
        position: patch.theme.position,
        borderRadius: Math.min(24, Math.max(0, Number(patch.theme.borderRadius ?? 12))),
        starterPrompts: (patch.theme.starterPrompts ?? []).slice(0, 6).map((s) => clampStr(s, 140)),
        enableCustomerHistory: patch.theme.enableCustomerHistory !== false,
        historyRetentionDays: Math.min(365, Math.max(1, Math.round(Number(patch.theme.historyRetentionDays ?? 30)))),
        enableVoiceMode: Boolean(patch.theme.enableVoiceMode),
        voiceName: normalizeVoiceName(patch.theme.voiceName),
      },
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateProjectApiKeyDoc(orgId: string, projectId: string, apiKey: string): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'projects', projectId), {
      apiKey: clampStr(apiKey, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateProjectIdentityDoc(
  orgId: string,
  projectId: string,
  patch: { identitySecret: string; loginUrl: string; hostedSignIn: boolean }
): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'projects', projectId), {
      identitySecret: clampStr(patch.identitySecret, 120),
      loginUrl: clampStr(patch.loginUrl, 500),
      hostedSignIn: patch.hostedSignIn === true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateProjectStorePageDoc(orgId: string, projectId: string, page: StorePage): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'projects', projectId), {
      storePage: {
        published: Boolean(page.published),
        title: clampStr(page.title, 100),
        tagline: clampStr(page.tagline, 200),
        logoUrl: clampStr(page.logoUrl, 500),
        primaryColor: clampStr(page.primaryColor, 20),
        sections: (page.sections ?? []).slice(0, 10).map((s) => ({
          id: clampStr(s.id, 64),
          type: s.type,
          enabled: Boolean(s.enabled),
          heading: clampStr(s.heading, 120),
          body: clampStr(s.body, 2000),
          imageUrl: clampStr(s.imageUrl, 500),
          items: (s.items ?? []).slice(0, 12).map((it) => ({
            title: clampStr(it.title, 120),
            subtitle: clampStr(it.subtitle, 300),
            price: clampStr(it.price, 40),
            imageUrl: clampStr(it.imageUrl, 500),
          })),
        })),
      },
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateProjectKnowledgeStatsDoc(
  orgId: string,
  projectId: string,
  stats: { knowledgeBrief: string; chunkCount: number; sourceCount: number }
): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}`;
  try {
    await updateDoc(doc(db, 'organizations', orgId, 'projects', projectId), {
      knowledgeBrief: clampStr(stats.knowledgeBrief, 6000),
      chunkCount: Math.max(0, Number(stats.chunkCount)),
      sourceCount: Math.max(0, Number(stats.sourceCount)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function fetchProjectResources(orgId: string, projectId: string, uid: string): Promise<{
  sources: DataSource[];
  chunks: KnowledgeChunk[];
  mcps: McpConnection[];
  traces: TraceLog[];
}> {
  const basePath = `organizations/${orgId}/projects/${projectId}`;
  try {
    const [srcSnap, chkSnap, mcpSnap, trSnap] = await Promise.all([
      getDocs(query(collection(db, `${basePath}/sources`), where('ownerId', '==', uid))),
      getDocs(query(collection(db, `${basePath}/chunks`), where('ownerId', '==', uid))),
      getDocs(query(collection(db, `${basePath}/mcps`), where('ownerId', '==', uid))),
      getDocs(query(collection(db, `${basePath}/traces`), where('ownerId', '==', uid))),
    ]);

    return {
      sources: srcSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          orgId: String(x.orgId),
          projectId: String(x.projectId),
          ownerId: String(x.ownerId),
          name: String(x.name),
          sourceType: x.sourceType,
          configSummary: String(x.configSummary ?? ''),
          status: x.status,
          chunkCount: Number(x.chunkCount ?? 0),
          summary: String(x.summary ?? ''),
          createdAt: tsToIso(x.createdAt),
          updatedAt: tsToIso(x.updatedAt),
        };
      }),
      chunks: chkSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          orgId: String(x.orgId),
          projectId: String(x.projectId),
          sourceId: String(x.sourceId),
          ownerId: String(x.ownerId),
          sourceName: String(x.sourceName),
          content: String(x.content),
          tokenEstimate: Number(x.tokenEstimate ?? 0),
          embedding: Array.isArray(x.embedding) ? x.embedding : [],
          createdAt: tsToIso(x.createdAt),
        };
      }),
      mcps: mcpSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          orgId: String(x.orgId),
          projectId: String(x.projectId),
          ownerId: String(x.ownerId),
          name: String(x.name),
          endpointUrl: String(x.endpointUrl),
          transport: x.transport,
          authHeaderName: String(x.authHeaderName ?? ''),
          authTokenMasked: String(x.authTokenMasked ?? ''),
          enabled: Boolean(x.enabled),
          status: x.status,
          tools: Array.isArray(x.tools) ? x.tools : [],
          createdAt: tsToIso(x.createdAt),
          updatedAt: tsToIso(x.updatedAt),
        };
      }),
      traces: trSnap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            orgId: String(x.orgId),
            projectId: String(x.projectId),
            ownerId: String(x.ownerId),
            query: String(x.query),
            responsePreview: String(x.responsePreview ?? ''),
            latencyMs: Number(x.latencyMs ?? 0),
            promptTokens: Number(x.promptTokens ?? 0),
            completionTokens: Number(x.completionTokens ?? 0),
            statusCode: Number(x.statusCode ?? 200),
            channel: x.channel,
            citations: Array.isArray(x.citations) ? x.citations : [],
            mcpCalls: Array.isArray(x.mcpCalls) ? x.mcpCalls : [],
            createdAt: tsToIso(x.createdAt),
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, basePath);
  }
}

export async function createDataSourceWithChunks(
  source: DataSource,
  chunks: KnowledgeChunk[]
): Promise<void> {
  const srcPath = `organizations/${source.orgId}/projects/${source.projectId}/sources/${source.id}`;
  try {
    const safeName = clampStr(source.name?.trim() || 'Untitled Source', 120);
    const batch = writeBatch(db);

    batch.set(doc(db, srcPath), {
      orgId: clampStr(source.orgId, 128),
      projectId: clampStr(source.projectId, 128),
      ownerId: clampStr(source.ownerId, 128),
      name: safeName,
      sourceType: source.sourceType,
      configSummary: clampStr(source.configSummary, 500),
      status: source.status,
      chunkCount: Math.min(10000, Math.max(0, Number(source.chunkCount) || 0)),
      summary: clampStr(source.summary, 2000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const validChunks = chunks
      .filter((c) => typeof c.content === 'string' && c.content.trim().length > 0)
      .slice(0, 40);

    for (const chunk of validChunks) {
      const chkPath = `organizations/${chunk.orgId}/projects/${chunk.projectId}/chunks/${chunk.id}`;
      batch.set(doc(db, chkPath), {
        orgId: clampStr(chunk.orgId, 128),
        projectId: clampStr(chunk.projectId, 128),
        sourceId: clampStr(chunk.sourceId, 128),
        ownerId: clampStr(chunk.ownerId, 128),
        sourceName: clampStr(chunk.sourceName?.trim() || safeName, 120),
        content: clampStr(chunk.content.trim(), 8000),
        tokenEstimate: Math.min(5000, Math.max(0, Math.round(Number(chunk.tokenEstimate) || 0))),
        embedding: (chunk.embedding ?? []).slice(0, 1024),
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, srcPath);
  }
}

export async function createMcpConnectionDoc(mcp: McpConnection): Promise<void> {
  const path = `organizations/${mcp.orgId}/projects/${mcp.projectId}/mcps/${mcp.id}`;
  try {
    await setDoc(doc(db, path), {
      orgId: clampStr(mcp.orgId, 128),
      projectId: clampStr(mcp.projectId, 128),
      ownerId: clampStr(mcp.ownerId, 128),
      name: clampStr(mcp.name, 100),
      endpointUrl: clampStr(mcp.endpointUrl, 500),
      transport: mcp.transport,
      authHeaderName: clampStr(mcp.authHeaderName, 80),
      authTokenMasked: clampStr(mcp.authTokenMasked, 120),
      enabled: Boolean(mcp.enabled),
      status: mcp.status,
      tools: (mcp.tools ?? []).slice(0, 50),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateMcpConnectionStateDoc(
  orgId: string,
  projectId: string,
  mcpId: string,
  patch: Pick<McpConnection, 'enabled' | 'tools' | 'status'>
): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}/mcps/${mcpId}`;
  try {
    await updateDoc(doc(db, path), {
      enabled: Boolean(patch.enabled),
      tools: (patch.tools ?? []).slice(0, 50),
      status: patch.status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteMcpConnectionDoc(orgId: string, projectId: string, mcpId: string): Promise<void> {
  const path = `organizations/${orgId}/projects/${projectId}/mcps/${mcpId}`;
  try {
    await deleteDoc(doc(db, path));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createTraceLogDoc(trace: TraceLog): Promise<void> {
  const path = `organizations/${trace.orgId}/projects/${trace.projectId}/traces/${trace.id}`;
  try {
    await setDoc(doc(db, path), {
      orgId: clampStr(trace.orgId, 128),
      projectId: clampStr(trace.projectId, 128),
      ownerId: clampStr(trace.ownerId, 128),
      query: clampStr(trace.query, 2000),
      responsePreview: clampStr(trace.responsePreview, 2000),
      latencyMs: Math.min(300000, Math.max(0, Number(trace.latencyMs))),
      promptTokens: Math.min(500000, Math.max(0, Number(trace.promptTokens))),
      completionTokens: Math.min(500000, Math.max(0, Number(trace.completionTokens))),
      statusCode: Math.min(599, Math.max(100, Number(trace.statusCode))),
      channel: trace.channel,
      citations: (trace.citations ?? []).slice(0, 10).map((s) => clampStr(s, 200)),
      mcpCalls: (trace.mcpCalls ?? []).slice(0, 10).map((s) => clampStr(s, 200)),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
