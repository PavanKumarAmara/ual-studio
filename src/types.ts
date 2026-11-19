export type SourceType = 'flatfile' | 'postgres' | 's3_public' | 'website';
export type SourceStatus = 'indexed' | 'syncing' | 'error';
export type McpTransport = 'streamable_http' | 'sse';
export type TraceChannel = 'api' | 'hosted' | 'widget' | 'playground';

export type LiveVoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export interface ChatTheme {
  primaryColor: string;
  surfaceColor: string;
  textColor: string;
  headerTitle: string;
  subtitle: string;
  welcomeMessage: string;
  position: 'bottom-right' | 'bottom-left';
  borderRadius: number;
  starterPrompts: string[];
  enableCustomerHistory?: boolean;
  historyRetentionDays?: number;
  enableVoiceMode?: boolean;
  voiceName?: LiveVoiceName;
}

export interface CustomerConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatTurnMessage[];
}

export interface Organization {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  industry: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  orgId: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  knowledgeBrief: string;
  apiKey: string;
  status: 'active' | 'paused';
  theme: ChatTheme;
  chunkCount: number;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: string;
  orgId: string;
  projectId: string;
  ownerId: string;
  name: string;
  sourceType: SourceType;
  configSummary: string;
  status: SourceStatus;
  chunkCount: number;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  orgId: string;
  projectId: string;
  sourceId: string;
  ownerId: string;
  sourceName: string;
  content: string;
  tokenEstimate: number;
  embedding: number[];
  createdAt: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

export interface McpConnection {
  id: string;
  orgId: string;
  projectId: string;
  ownerId: string;
  name: string;
  endpointUrl: string;
  transport: McpTransport;
  authHeaderName: string;
  authTokenMasked: string;
  authTokenRaw?: string; // Held in runtime memory only, never persisted unmasked to Firestore
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  tools: McpTool[];
  createdAt: string;
  updatedAt: string;
}

export interface TraceLog {
  id: string;
  orgId: string;
  projectId: string;
  ownerId: string;
  query: string;
  responsePreview: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  statusCode: number;
  channel: TraceChannel;
  citations: string[];
  mcpCalls: string[];
  createdAt: string;
}

export interface BotRuntimeSnapshot {
  orgSlug: string;
  orgName: string;
  project: Project;
  chunks: KnowledgeChunk[];
  mcps: McpConnection[];
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  mcpCalls?: Array<{
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    resultPreview: string;
    durationMs: number;
    status: 'ok' | 'error';
  }>;
  latencyMs?: number;
  tokens?: number;
}

export interface ProductInsightTheme {
  topic: string;
  questionCount: number;
  sampleQuestion: string;
  sentiment: 'positive' | 'neutral' | 'friction';
}

export interface ProductKnowledgeGap {
  gap: string;
  frequencyHint: string;
  suggestedSource: string;
}

export interface ProductImprovementAction {
  area: 'Product' | 'Documentation' | 'Support Workflow' | 'Integration';
  title: string;
  rationale: string;
  impact: 'High' | 'Medium';
}

export interface ProductInsightReport {
  executiveSummary: string;
  topThemes: ProductInsightTheme[];
  knowledgeGaps: ProductKnowledgeGap[];
  productImprovements: ProductImprovementAction[];
  generatedAt: string;
  analyzedTraceCount: number;
}

