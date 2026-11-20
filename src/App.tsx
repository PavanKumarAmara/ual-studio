import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase';
import {
  createDataSourceWithChunks,
  createMcpConnectionDoc,
  createOrganizationDoc,
  createProjectDoc,
  createTraceLogDoc,
  deleteMcpConnectionDoc,
  fetchOrgProjects,
  fetchProjectResources,
  fetchUserOrganizations,
  updateMcpConnectionStateDoc,
  updateProjectApiKeyDoc,
  updateProjectIdentityDoc,
  updateProjectStorePageDoc,
  updateProjectConfigDoc,
  updateProjectKnowledgeStatsDoc,
} from './lib/firestoreRepo';
import {
  DEMO_OWNER_ID,
  SEED_CHUNKS,
  SEED_MCPS,
  SEED_ORGANIZATIONS,
  SEED_PROJECTS,
  SEED_SOURCES,
  SEED_TRACES,
} from './utils/seedData';
import { generateApiKey, slugify } from './utils/ingestion';
import type {
  ChatTheme,
  DataSource,
  KnowledgeChunk,
  McpConnection,
  McpTool,
  McpTransport,
  Organization,
  Project,
  SourceType,
  StorePage,
  TraceLog,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { CompanyOnboarding } from './components/CompanyOnboarding';
import { Sidebar, type WorkspaceTab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { NewOrgModal, NewProjectModal } from './components/Modals';
import { OverviewTab } from './components/OverviewTab';
import { ConnectorsTab } from './components/ConnectorsTab';
import { McpTab } from './components/McpTab';
import { ThemeStudioTab } from './components/ThemeStudioTab';
import { ObservabilityTab } from './components/ObservabilityTab';
import { GcpArchitectureTab } from './components/GcpArchitectureTab';
import { HostedChatPage } from './components/HostedChatPage';
import { StorePageView } from './components/StorePageView';
import { StorePageTab } from './components/StorePageTab';

function parseHostedRoute(pathname: string): { orgSlug: string; botSlug: string } | null {
  const match = /^\/c\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return {
    orgSlug: decodeURIComponent(match[1]),
    botSlug: decodeURIComponent(match[2]),
  };
}

function parseStoreRoute(pathname: string): { orgSlug: string; botSlug: string } | null {
  const match = /^\/s\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return {
    orgSlug: decodeURIComponent(match[1]),
    botSlug: decodeURIComponent(match[2]),
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 10) return '••••••••';
  return `${token.slice(0, 8)}••••••••`;
}

function RelayMeshApp() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);
  const [searchParams] = useState<URLSearchParams>(() => new URLSearchParams(window.location.search));
  const isEmbed = searchParams.get('embed') === '1';
  const autostartMode = searchParams.get('autostart'); // null for normal users; '1' or 'onboarding' for automated test harness

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(Boolean(autostartMode));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [cloudSyncBanner, setCloudSyncBanner] = useState<string>('');

  // Strictly empty by default — workspace data is loaded ONLY after sign-in (or internal autostart test mode)
  const [organizations, setOrganizations] = useState<Organization[]>(() =>
    autostartMode === '1' ? SEED_ORGANIZATIONS : []
  );
  const [projects, setProjects] = useState<Project[]>(() =>
    autostartMode === '1' ? SEED_PROJECTS : []
  );
  const [sources, setSources] = useState<DataSource[]>(() =>
    autostartMode === '1' ? SEED_SOURCES : []
  );
  const [chunks, setChunks] = useState<KnowledgeChunk[]>(() =>
    autostartMode === '1' ? SEED_CHUNKS : []
  );
  const [mcps, setMcps] = useState<McpConnection[]>(() =>
    autostartMode === '1' ? SEED_MCPS : []
  );
  const [traces, setTraces] = useState<TraceLog[]>(() =>
    autostartMode === '1' ? SEED_TRACES : []
  );

  const [activeOrgId, setActiveOrgId] = useState<string>(() =>
    autostartMode === '1' ? SEED_ORGANIZATIONS[0].id : ''
  );
  const [activeProjectId, setActiveProjectId] = useState<string>(() =>
    autostartMode === '1' ? SEED_PROJECTS[0].id : ''
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [refreshingTraces, setRefreshingTraces] = useState(false);

  const hostedRoute = useMemo(() => parseHostedRoute(pathname), [pathname]);
  const storeRoute = useMemo(() => parseStoreRoute(pathname), [pathname]);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setPathname(nextPath);
  }, []);

  const clearWorkspaceState = useCallback(() => {
    setOrganizations([]);
    setProjects([]);
    setSources([]);
    setChunks([]);
    setMcps([]);
    setTraces([]);
    setActiveOrgId('');
    setActiveProjectId('');
    setCloudSyncBanner('');
  }, []);

  // Firebase Auth listener — enforces strict user-scoped workspace loading
  useEffect(() => {
    if (autostartMode) {
      setAuthReady(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      if (!firebaseUser) {
        clearWorkspaceState();
        setWorkspaceLoading(false);
        return;
      }

      setWorkspaceLoading(true);
      setCloudSyncBanner('');
      try {
        const userOrgs = await fetchUserOrganizations(firebaseUser.uid);
        if (userOrgs.length > 0) {
          setOrganizations(userOrgs);
          const firstOrg = userOrgs[0];
          setActiveOrgId(firstOrg.id);
          const orgProjs = await fetchOrgProjects(firstOrg.id, firebaseUser.uid);
          setProjects(orgProjs);
          if (orgProjs.length > 0) {
            setActiveProjectId(orgProjs[0].id);
            const res = await fetchProjectResources(firstOrg.id, orgProjs[0].id, firebaseUser.uid);
            setSources(res.sources);
            setChunks(res.chunks);
            setMcps(res.mcps);
            setTraces(res.traces);
          } else {
            setActiveProjectId('');
            setSources([]);
            setChunks([]);
            setMcps([]);
            setTraces([]);
          }
        } else {
          // New signed-in user starts with an isolated empty account -> directed to CompanyOnboarding
          clearWorkspaceState();
        }
      } catch (err) {
        console.error('Firestore load error:', err);
        setCloudSyncBanner('Signed in, but loading your workspace encountered an error. Please retry or check permissions.');
      } finally {
        setWorkspaceLoading(false);
      }
    });
    return () => unsub();
  }, [autostartMode, clearWorkspaceState]);

  const activeOrg = useMemo(
    () => organizations.find((o) => o.id === activeOrgId) ?? organizations[0] ?? null,
    [organizations, activeOrgId]
  );

  const orgProjects = useMemo(
    () => projects.filter((p) => p.orgId === activeOrg?.id),
    [projects, activeOrg]
  );

  const activeProject = useMemo(
    () => orgProjects.find((p) => p.id === activeProjectId) ?? orgProjects[0] ?? null,
    [orgProjects, activeProjectId]
  );

  const projectSources = useMemo(
    () => sources.filter((s) => s.projectId === activeProject?.id),
    [sources, activeProject]
  );
  const projectChunks = useMemo(
    () => chunks.filter((c) => c.projectId === activeProject?.id),
    [chunks, activeProject]
  );
  const projectMcps = useMemo(
    () => mcps.filter((m) => m.projectId === activeProject?.id),
    [mcps, activeProject]
  );
  const projectTraces = useMemo(
    () => traces.filter((t) => t.projectId === activeProject?.id),
    [traces, activeProject]
  );

  const activeMcpToolCount = useMemo(
    () =>
      projectMcps
        .filter((m) => m.enabled && m.status === 'connected')
        .reduce((sum, m) => sum + m.tools.filter((t) => t.enabled).length, 0),
    [projectMcps]
  );

  // Sync active bot snapshot to Express runtime so /api/v1/bots/:org/:bot/chat, /c/:org/:bot, and /embed/:org/:bot.js stay live
  useEffect(() => {
    if (!activeOrg || !activeProject) return;
    fetch('/api/runtime/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgSlug: activeOrg.slug,
        orgName: activeOrg.name,
        project: activeProject,
        chunks: projectChunks,
        mcps: projectMcps,
      }),
    }).catch(() => undefined);
  }, [activeOrg, activeProject, projectChunks, projectMcps]);

  const refreshServerTraces = useCallback(async () => {
    if (!activeOrg || !activeProject) return;
    setRefreshingTraces(true);
    try {
      const res = await fetch(`/api/runtime/traces/${encodeURIComponent(activeOrg.slug)}/${encodeURIComponent(activeProject.slug)}`);
      const data = await res.json();
      if (Array.isArray(data.traces)) {
        setTraces((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const incoming = (data.traces as TraceLog[]).filter((t) => !existingIds.has(t.id));
          return [...incoming, ...prev];
        });
      }
    } finally {
      setRefreshingTraces(false);
    }
  }, [activeOrg, activeProject]);

  useEffect(() => {
    if (activeTab === 'observability') {
      refreshServerTraces();
    }
  }, [activeTab, refreshServerTraces]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
      let msg = err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.';
      if (code === 'auth/unauthorized-domain') {
        msg = `This domain (${window.location.hostname}) is not authorized in Firebase Authentication. Add it under Firebase Console → Authentication → Settings → Authorized domains, then retry.`;
      } else if (code === 'auth/popup-blocked') {
        msg = 'Google Sign-In popup was blocked by your browser. Allow popups for this site and try again.';
      }
      setAuthError(msg);
      console.error('Google Sign-In failed:', err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (autostartMode) {
      navigate('/');
      window.location.href = '/';
      return;
    }
    await signOut(auth);
    clearWorkspaceState();
  };

  const handleOnboardingRegister = async (data: {
    companyName: string;
    companySlug: string;
    industry: string;
    firstBotName: string;
  }) => {
    const ownerId = user?.uid ?? DEMO_OWNER_ID;
    const nowIso = new Date().toISOString();
    const newOrg: Organization = {
      id: makeId('org'),
      ownerId,
      name: data.companyName,
      slug: data.companySlug,
      industry: data.industry,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const botSlug = slugify(data.firstBotName);
    const newProj: Project = {
      id: makeId('proj'),
      orgId: newOrg.id,
      ownerId,
      name: data.firstBotName,
      slug: botSlug,
      description: `Primary customer assistant for ${data.companyName}.`,
      systemPrompt: `You are ${data.firstBotName} for ${data.companyName}. Answer customer questions clearly using connected knowledge sources and live MCP tools.`,
      knowledgeBrief: '',
      apiKey: generateApiKey(),
      identitySecret: generateApiKey('idsec'),
      loginUrl: '',
      status: 'active',
      theme: {
        primaryColor: '#2563EB',
        surfaceColor: '#FFFFFF',
        textColor: '#0F172A',
        headerTitle: data.firstBotName,
        subtitle: `${data.companyName} Assistant`,
        welcomeMessage: `Hello! I am ${data.firstBotName}. How can I help you today?`,
        position: 'bottom-right',
        borderRadius: 12,
        starterPrompts: ['What services do you offer?', 'How can I contact support?'],
      },
      chunkCount: 0,
      sourceCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (user) {
      await createOrganizationDoc(newOrg);
      await createProjectDoc(newProj);
    }

    setOrganizations([newOrg]);
    setProjects([newProj]);
    setSources([]);
    setChunks([]);
    setMcps([]);
    setTraces([]);
    setActiveOrgId(newOrg.id);
    setActiveProjectId(newProj.id);
    setActiveTab('overview');
  };

  const handleLoadSampleIntoAccount = async () => {
    const ownerId = user?.uid ?? DEMO_OWNER_ID;
    const nowIso = new Date().toISOString();
    const starterOrg: Organization = {
      ...SEED_ORGANIZATIONS[0],
      id: makeId('org'),
      ownerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const starterProj: Project = {
      ...SEED_PROJECTS[0],
      id: makeId('proj'),
      orgId: starterOrg.id,
      ownerId,
      apiKey: generateApiKey(),
      identitySecret: generateApiKey('idsec'),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const starterMcp: McpConnection = {
      ...SEED_MCPS[0],
      id: makeId('mcp'),
      orgId: starterOrg.id,
      projectId: starterProj.id,
      ownerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const starterSrc: DataSource = {
      ...SEED_SOURCES[0],
      id: makeId('src'),
      orgId: starterOrg.id,
      projectId: starterProj.id,
      ownerId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const starterChunks: KnowledgeChunk[] = SEED_CHUNKS.filter(
      (c) => c.projectId === SEED_PROJECTS[0].id
    ).map((c) => ({
      ...c,
      id: makeId('chk'),
      orgId: starterOrg.id,
      projectId: starterProj.id,
      sourceId: starterSrc.id,
      ownerId,
      createdAt: nowIso,
    }));

    const starterTraces: TraceLog[] = SEED_TRACES.filter(
      (t) => t.projectId === SEED_PROJECTS[0].id
    ).map((t) => ({
      ...t,
      id: makeId('tr'),
      orgId: starterOrg.id,
      projectId: starterProj.id,
      ownerId,
    }));

    if (user) {
      await createOrganizationDoc(starterOrg);
      await createProjectDoc(starterProj);
      await createMcpConnectionDoc(starterMcp);
      await createDataSourceWithChunks(starterSrc, starterChunks);
      for (const tr of starterTraces) {
        await createTraceLogDoc(tr);
      }
    }

    setOrganizations([starterOrg]);
    setProjects([starterProj]);
    setSources([starterSrc]);
    setChunks(starterChunks);
    setMcps([starterMcp]);
    setTraces(starterTraces);
    setActiveOrgId(starterOrg.id);
    setActiveProjectId(starterProj.id);
    setActiveTab('overview');
  };

  const handleSelectOrg = async (orgId: string) => {
    setActiveOrgId(orgId);
    if (user) {
      const orgProjs = await fetchOrgProjects(orgId, user.uid);
      setProjects(orgProjs);
      if (orgProjs[0]) {
        setActiveProjectId(orgProjs[0].id);
        const res = await fetchProjectResources(orgId, orgProjs[0].id, user.uid);
        setSources(res.sources);
        setChunks(res.chunks);
        setMcps(res.mcps);
        setTraces(res.traces);
      } else {
        setActiveProjectId('');
        setSources([]);
        setChunks([]);
        setMcps([]);
        setTraces([]);
      }
    } else {
      const nextProj = projects.find((p) => p.orgId === orgId);
      setActiveProjectId(nextProj?.id ?? '');
    }
  };

  const handleSelectProject = async (projectId: string) => {
    setActiveProjectId(projectId);
    if (user && activeOrg) {
      const res = await fetchProjectResources(activeOrg.id, projectId, user.uid);
      setSources(res.sources);
      setChunks(res.chunks);
      setMcps(res.mcps);
      setTraces(res.traces);
    }
  };

  const handleCreateOrg = async (data: { name: string; slug: string; industry: string }) => {
    const nowIso = new Date().toISOString();
    const newOrg: Organization = {
      id: makeId('org'),
      ownerId: user?.uid ?? DEMO_OWNER_ID,
      name: data.name,
      slug: data.slug,
      industry: data.industry,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (user) {
      await createOrganizationDoc(newOrg);
    }
    setOrganizations((prev) => [...prev, newOrg]);
    setActiveOrgId(newOrg.id);
    setActiveProjectId('');
  };

  const handleCreateProject = async (data: {
    name: string;
    slug: string;
    description: string;
    systemPrompt: string;
  }) => {
    if (!activeOrg) return;
    const nowIso = new Date().toISOString();
    const newProj: Project = {
      id: makeId('proj'),
      orgId: activeOrg.id,
      ownerId: user?.uid ?? DEMO_OWNER_ID,
      name: data.name,
      slug: data.slug,
      description: data.description,
      systemPrompt: data.systemPrompt,
      knowledgeBrief: '',
      apiKey: generateApiKey(),
      identitySecret: generateApiKey('idsec'),
      loginUrl: '',
      status: 'active',
      theme: {
        primaryColor: '#2563EB',
        surfaceColor: '#FFFFFF',
        textColor: '#0F172A',
        headerTitle: data.name,
        subtitle: `${activeOrg.name} Assistant`,
        welcomeMessage: `Hello! I am ${data.name}. Ask me anything from our connected knowledge sources.`,
        position: 'bottom-right',
        borderRadius: 12,
        starterPrompts: ['What knowledge sources are connected?'],
      },
      chunkCount: 0,
      sourceCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (user) {
      await createProjectDoc(newProj);
    }
    setProjects((prev) => [...prev, newProj]);
    setActiveProjectId(newProj.id);
    setActiveTab('overview');
  };

  const handleRotateKey = async () => {
    if (!activeOrg || !activeProject) return;
    const nextKey = generateApiKey();
    if (user) {
      await updateProjectApiKeyDoc(activeOrg.id, activeProject.id, nextKey);
    }
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, apiKey: nextKey } : p))
    );
  };

  // Backfill identity secrets for bots created before customer identity verification existed
  useEffect(() => {
    const missing = projects.filter((p) => !p.identitySecret);
    if (missing.length === 0) return;
    const patched = missing.map((p) => ({ ...p, identitySecret: generateApiKey('idsec'), loginUrl: p.loginUrl ?? '' }));
    setProjects((prev) => prev.map((p) => patched.find((x) => x.id === p.id) ?? p));
    if (user) {
      for (const p of patched) {
        void updateProjectIdentityDoc(p.orgId, p.id, { identitySecret: p.identitySecret, loginUrl: p.loginUrl });
      }
    }
  }, [projects, user]);

  const handleSaveIdentity = async (patch: { identitySecret: string; loginUrl: string }) => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await updateProjectIdentityDoc(activeOrg.id, activeProject.id, patch);
    }
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, ...patch } : p))
    );
  };

  const handleSavePrompt = async (systemPrompt: string, status: 'active' | 'paused') => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await updateProjectConfigDoc(activeOrg.id, activeProject.id, {
        name: activeProject.name,
        description: activeProject.description,
        systemPrompt,
        theme: activeProject.theme,
        status,
      });
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id ? { ...p, systemPrompt, status, updatedAt: new Date().toISOString() } : p
      )
    );
  };

  const handleSaveTheme = async (theme: ChatTheme) => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await updateProjectConfigDoc(activeOrg.id, activeProject.id, {
        name: activeProject.name,
        description: activeProject.description,
        systemPrompt: activeProject.systemPrompt,
        theme,
        status: activeProject.status,
      });
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id ? { ...p, theme, updatedAt: new Date().toISOString() } : p
      )
    );
  };

  const handleSourceIngested = async (payload: {
    sourceType: SourceType;
    name: string;
    configSummary: string;
    summary: string;
    knowledgeBrief: string;
    chunks: Array<{
      sourceName: string;
      content: string;
      tokenEstimate: number;
      embedding: number[];
    }>;
  }) => {
    if (!activeOrg || !activeProject) return;
    const nowIso = new Date().toISOString();
    const ownerId = user?.uid ?? DEMO_OWNER_ID;
    const sourceId = makeId('src');

    const newSource: DataSource = {
      id: sourceId,
      orgId: activeOrg.id,
      projectId: activeProject.id,
      ownerId,
      name: payload.name,
      sourceType: payload.sourceType,
      configSummary: payload.configSummary,
      status: 'indexed',
      chunkCount: payload.chunks.length,
      summary: payload.summary,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const newChunks: KnowledgeChunk[] = payload.chunks.map((c) => ({
      id: makeId('chk'),
      orgId: activeOrg.id,
      projectId: activeProject.id,
      sourceId,
      ownerId,
      sourceName: c.sourceName,
      content: c.content,
      tokenEstimate: c.tokenEstimate,
      embedding: c.embedding,
      createdAt: nowIso,
    }));

    const nextSourceCount = projectSources.length + 1;
    const nextChunkCount = projectChunks.length + newChunks.length;

    if (user) {
      await createDataSourceWithChunks(newSource, newChunks);
      await updateProjectKnowledgeStatsDoc(activeOrg.id, activeProject.id, {
        knowledgeBrief: payload.knowledgeBrief,
        sourceCount: nextSourceCount,
        chunkCount: nextChunkCount,
      });
    }

    setSources((prev) => [newSource, ...prev]);
    setChunks((prev) => [...newChunks, ...prev]);
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              knowledgeBrief: payload.knowledgeBrief,
              sourceCount: nextSourceCount,
              chunkCount: nextChunkCount,
              updatedAt: nowIso,
            }
          : p
      )
    );
  };

  const handleAddMcp = async (payload: {
    name: string;
    endpointUrl: string;
    transport: McpTransport;
    authHeaderName: string;
    authTokenRaw: string;
    tools: McpTool[];
  }) => {
    if (!activeOrg || !activeProject) return;
    const nowIso = new Date().toISOString();
    const newMcp: McpConnection = {
      id: makeId('mcp'),
      orgId: activeOrg.id,
      projectId: activeProject.id,
      ownerId: user?.uid ?? DEMO_OWNER_ID,
      name: payload.name,
      endpointUrl: payload.endpointUrl,
      transport: payload.transport,
      authHeaderName: payload.authHeaderName,
      authTokenMasked: maskToken(payload.authTokenRaw),
      authTokenRaw: payload.authTokenRaw,
      enabled: true,
      status: 'connected',
      tools: payload.tools,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (user) {
      await createMcpConnectionDoc(newMcp);
    }
    setMcps((prev) => [newMcp, ...prev]);
  };

  const handleUpdateMcp = async (
    mcpId: string,
    patch: Pick<McpConnection, 'enabled' | 'tools' | 'status'>
  ) => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await updateMcpConnectionStateDoc(activeOrg.id, activeProject.id, mcpId, patch);
    }
    setMcps((prev) =>
      prev.map((m) => (m.id === mcpId ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m))
    );
  };

  const handleDeleteMcp = async (mcpId: string) => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await deleteMcpConnectionDoc(activeOrg.id, activeProject.id, mcpId);
    }
    setMcps((prev) => prev.filter((m) => m.id !== mcpId));
  };

  const handleSaveStorePage = async (page: StorePage) => {
    if (!activeOrg || !activeProject) return;
    if (user) {
      await updateProjectStorePageDoc(activeOrg.id, activeProject.id, page);
    }
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, storePage: page } : p))
    );
  };

  const handleRecordTrace = useCallback(
    (trace: TraceLog) => {
      setTraces((prev) => {
        if (prev.some((t) => t.id === trace.id)) return prev;
        return [trace, ...prev];
      });
      if (user && activeOrg && activeProject) {
        createTraceLogDoc({
          ...trace,
          orgId: activeOrg.id,
          projectId: activeProject.id,
          ownerId: user.uid,
        }).catch((err) => console.error('Failed to persist trace log:', err));
      }
    },
    [user, activeOrg, activeProject]
  );

  // Route 1: Standalone Public Hosted Customer Chat Page (/c/:orgSlug/:botSlug)
  if (hostedRoute) {
    return (
      <HostedChatPage
        orgSlug={hostedRoute.orgSlug}
        botSlug={hostedRoute.botSlug}
        isEmbed={isEmbed}
        onBackToConsole={() => navigate('/')}
      />
    );
  }

  // Route 1b: Public Hosted Store Page (/s/:orgSlug/:botSlug)
  if (storeRoute) {
    return <StorePageView orgSlug={storeRoute.orgSlug} botSlug={storeRoute.botSlug} />;
  }

  // Route 2: Checking Firebase Auth state (never flash foreign workspace data)
  if (!authReady || workspaceLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-bold tracking-tight text-slate-900">Unified Agentic Layer (UAL)</p>
          <p className="text-xs text-slate-500">Loading your private workspace...</p>
        </div>
      </div>
    );
  }

  const isAuthenticated = Boolean(user) || Boolean(autostartMode);

  // Route 3: Unauthenticated Home Screen (Product Showcase — zero company data exposed)
  if (!isAuthenticated) {
    return (
      <LandingPage
        authLoading={authLoading}
        authError={authError}
        onSignIn={handleSignIn}
      />
    );
  }

  // Route 4: Authenticated First-Time Company Registration (user has 0 companies yet)
  if (organizations.length === 0) {
    return (
      <CompanyOnboarding
        userEmail={user?.email ?? 'account@company.com'}
        userDisplayName={user?.displayName ?? ''}
        syncError={cloudSyncBanner}
        onSignOut={handleSignOut}
        onRegisterCompany={handleOnboardingRegister}
        onLoadSampleWorkspace={handleLoadSampleIntoAccount}
      />
    );
  }

  // Route 5: Authenticated User-Specific B2B Admin Console
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      <Sidebar
        organizations={organizations}
        activeOrg={activeOrg}
        projects={orgProjects}
        activeProject={activeProject}
        activeTab={activeTab}
        onSelectOrg={handleSelectOrg}
        onSelectProject={handleSelectProject}
        onSelectTab={setActiveTab}
        onOpenNewOrg={() => setShowNewOrg(true)}
        onOpenNewProject={() => setShowNewProject(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          org={activeOrg}
          project={activeProject}
          activeTab={activeTab}
          user={user}
          authLoading={authLoading}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onOpenHostedChat={() => {
            if (activeOrg && activeProject) {
              navigate(`/c/${activeOrg.slug}/${activeProject.slug}`);
            }
          }}
        />

        <main className="flex-1 p-6 max-w-[1360px] w-full mx-auto space-y-5">
          {cloudSyncBanner && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-3 text-xs">
              {cloudSyncBanner}
            </div>
          )}

          {!activeProject || !activeOrg ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
              <h1 className="text-lg font-semibold text-slate-900">
                Create your first chatbot service for {activeOrg?.name ?? 'this company'}
              </h1>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Provisioning immediately generates a live REST API endpoint, hosted customer URL, drop-in widget script, and embedded observability.
              </p>
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Create Chatbot Service
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  org={activeOrg}
                  project={activeProject}
                  mcpToolCount={activeMcpToolCount}
                  traceCount={projectTraces.length}
                  onRotateKey={handleRotateKey}
                  onSavePrompt={handleSavePrompt}
                  onSaveIdentity={handleSaveIdentity}
                  onRecordTrace={handleRecordTrace}
                />
              )}

              {activeTab === 'connectors' && (
                <ConnectorsTab
                  project={activeProject}
                  sources={projectSources}
                  chunks={projectChunks}
                  onSourceIngested={handleSourceIngested}
                />
              )}

              {activeTab === 'mcp' && (
                <McpTab
                  mcps={projectMcps}
                  onAddMcp={handleAddMcp}
                  onUpdateMcp={handleUpdateMcp}
                  onDeleteMcp={handleDeleteMcp}
                />
              )}

              {activeTab === 'theme' && (
                <ThemeStudioTab
                  org={activeOrg}
                  project={activeProject}
                  onSaveTheme={handleSaveTheme}
                  onRecordTrace={handleRecordTrace}
                  onOpenHostedChat={() => navigate(`/c/${activeOrg.slug}/${activeProject.slug}`)}
                />
              )}

              {activeTab === 'storepage' && (
                <StorePageTab
                  org={activeOrg}
                  project={activeProject}
                  onSavePage={handleSaveStorePage}
                />
              )}

              {activeTab === 'observability' && (
                <ObservabilityTab
                  project={activeProject}
                  traces={projectTraces}
                  refreshing={refreshingTraces}
                  onRefresh={refreshServerTraces}
                />
              )}

              {activeTab === 'gcp' && (
                <GcpArchitectureTab org={activeOrg} project={activeProject} />
              )}
            </>
          )}
        </main>
      </div>

      <NewOrgModal
        open={showNewOrg}
        onClose={() => setShowNewOrg(false)}
        onCreate={handleCreateOrg}
      />

      <NewProjectModal
        open={showNewProject}
        orgSlug={activeOrg?.slug ?? 'company'}
        onClose={() => setShowNewProject(false)}
        onCreate={handleCreateProject}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <RelayMeshApp />
    </ErrorBoundary>
  );
}
