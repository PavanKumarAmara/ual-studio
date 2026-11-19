import type { McpTool } from '../src/types';

// --- Built-in Live Demo MCP Server (Streamable HTTP JSON-RPC 2.0) ---

const DEMO_SHIPMENTS: Record<
  string,
  {
    tracking_id: string;
    origin: string;
    destination: string;
    status: string;
    temperature_c: number;
    customs_state: string;
    eta_utc: string;
    carrier: string;
  }
> = {
  'MRD-8841': {
    tracking_id: 'MRD-8841',
    origin: 'Newark, NJ (EWR)',
    destination: 'Rotterdam, NL (RTM)',
    status: 'Customs Clearance In Progress',
    temperature_c: 4.2,
    customs_state: 'EORI & HS Codes verified — awaiting final port gate release',
    eta_utc: '2026-11-19T18:30:00Z',
    carrier: 'Meridian Cold-Chain Air #MC-402',
  },
  'MRD-9012': {
    tracking_id: 'MRD-9012',
    origin: 'Basel, CH (BSL)',
    destination: 'Boston, MA (BOS)',
    status: 'In Transit — Atlantic Corridor',
    temperature_c: 3.6,
    customs_state: 'Pre-cleared via CBP ACE',
    eta_utc: '2026-11-20T09:15:00Z',
    carrier: 'Meridian Express Cargo #MC-118',
  },
  'MRD-7720': {
    tracking_id: 'MRD-7720',
    origin: 'Singapore (SIN)',
    destination: 'Hamburg, DE (HAM)',
    status: 'Customs Hold — Missing EORI Reference',
    temperature_c: 5.1,
    customs_state: 'Action required: Commercial invoice missing EORI identifier',
    eta_utc: '2026-11-21T14:00:00Z',
    carrier: 'Meridian Ocean Reefer #MO-904',
  },
};

const DEMO_SLAS: Record<
  string,
  {
    company_code: string;
    company_name: string;
    tier: string;
    response_sla_minutes: number;
    cold_chain_uptime_pct: number;
    account_manager: string;
    credit_policy: string;
  }
> = {
  'ACME-01': {
    company_code: 'ACME-01',
    company_name: 'Acme BioPharma GmbH',
    tier: 'Enterprise Platinum',
    response_sla_minutes: 15,
    cold_chain_uptime_pct: 99.95,
    account_manager: 'Elena Rostova (elena.rostova@meridian.example)',
    credit_policy: '10% freight fee credit if reefer exceeds 2°C–8°C for >20 min',
  },
  'NORD-44': {
    company_code: 'NORD-44',
    company_name: 'Nordic Clinical Supply AB',
    tier: 'Business Priority',
    response_sla_minutes: 60,
    cold_chain_uptime_pct: 99.8,
    account_manager: 'Marcus Lind (marcus.lind@meridian.example)',
    credit_policy: '5% freight fee credit on verified customs brokerage delay >12h',
  },
};

const demoTickets: Array<{
  ticket_id: string;
  subject: string;
  priority: string;
  account_id: string;
  created_at: string;
}> = [];

export const DEMO_MCP_TOOL_DEFINITIONS: McpTool[] = [
  {
    name: 'lookup_shipment_status',
    description:
      'Look up real-time location, temperature, customs status, and ETA for a Meridian tracking ID (e.g. MRD-8841, MRD-9012, MRD-7720).',
    inputSchema: {
      type: 'object',
      properties: {
        tracking_id: {
          type: 'string',
          description: 'Shipment tracking ID such as MRD-8841',
        },
      },
      required: ['tracking_id'],
    },
    enabled: true,
  },
  {
    name: 'check_account_sla',
    description:
      'Retrieve contracted SLA response window, uptime guarantee, and account manager for a customer account code (e.g. ACME-01, NORD-44).',
    inputSchema: {
      type: 'object',
      properties: {
        company_code: {
          type: 'string',
          description: 'Customer account code such as ACME-01',
        },
      },
      required: ['company_code'],
    },
    enabled: true,
  },
  {
    name: 'create_support_ticket',
    description:
      'Create a live operations escalation ticket for customs holds, detention waivers, or temperature alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Short summary of the issue' },
        priority: { type: 'string', description: 'Ticket priority: low, medium, or high' },
        account_id: { type: 'string', description: 'Account code or shipment tracking ID' },
      },
      required: ['subject', 'priority', 'account_id'],
    },
    enabled: true,
  },
];

export function handleDemoMcpJsonRpc(body: Record<string, unknown>): Record<string, unknown> {
  const id = body.id ?? 1;
  const method = String(body.method ?? '');
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'meridian-operations-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: DEMO_MCP_TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(params.name ?? '');
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    if (toolName === 'lookup_shipment_status') {
      const code = String(args.tracking_id ?? '').trim().toUpperCase();
      const record = DEMO_SHIPMENTS[code];
      const payload = record
        ? record
        : {
            found: false,
            message: `No active shipment found for ${code || 'empty ID'}. Available demo IDs: MRD-8841, MRD-9012, MRD-7720.`,
          };
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        },
      };
    }

    if (toolName === 'check_account_sla') {
      const code = String(args.company_code ?? '').trim().toUpperCase();
      const record = DEMO_SLAS[code];
      const payload = record
        ? record
        : {
            found: false,
            message: `No SLA contract found for ${code || 'empty code'}. Available demo codes: ACME-01, NORD-44.`,
          };
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        },
      };
    }

    if (toolName === 'create_support_ticket') {
      const ticket = {
        ticket_id: `OPS-${4100 + demoTickets.length + 1}`,
        subject: String(args.subject ?? 'Operations Escalation'),
        priority: String(args.priority ?? 'medium'),
        account_id: String(args.account_id ?? 'UNSPECIFIED'),
        status: 'open',
        created_at: new Date().toISOString(),
      };
      demoTickets.push(ticket);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(ticket) }],
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unsupported MCP method: ${method}` },
  };
}

// --- Real External / Internal MCP Client (Streamable HTTP & SSE Parsing) ---

function resolveEndpointUrl(endpointUrl: string, serverBaseUrl: string): string {
  const trimmed = endpointUrl.trim();
  if (trimmed.startsWith('/')) {
    return `${serverBaseUrl.replace(/\/+$/, '')}${trimmed}`;
  }
  return trimmed;
}

async function sendMcpJsonRpc(params: {
  endpointUrl: string;
  authHeaderName?: string;
  authToken?: string;
  method: string;
  rpcParams?: Record<string, unknown>;
  serverBaseUrl: string;
}): Promise<Record<string, unknown>> {
  const targetUrl = resolveEndpointUrl(params.endpointUrl, params.serverBaseUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (params.authHeaderName && params.authToken) {
    headers[params.authHeaderName] = params.authToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: params.method,
        params: params.rpcParams ?? {},
      }),
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') ?? '';
    const rawText = await res.text();

    if (!res.ok) {
      throw new Error(`MCP server responded with HTTP ${res.status}: ${rawText.slice(0, 200)}`);
    }

    if (contentType.includes('text/event-stream')) {
      const dataLines = rawText
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      const lastJson = dataLines[dataLines.length - 1];
      if (!lastJson) {
        throw new Error('MCP SSE response did not contain a JSON-RPC payload.');
      }
      return JSON.parse(lastJson) as Record<string, unknown>;
    }

    return JSON.parse(rawText) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverMcpTools(params: {
  endpointUrl: string;
  authHeaderName?: string;
  authToken?: string;
  serverBaseUrl: string;
}): Promise<{ serverName: string; tools: McpTool[] }> {
  let serverName = 'External MCP Server';

  try {
    const initRes = await sendMcpJsonRpc({
      ...params,
      method: 'initialize',
      rpcParams: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'ual-mcp-client', version: '1.0.0' },
      },
    });
    const info = (initRes.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo;
    if (info?.name) {
      serverName = info.name;
    }
  } catch {
    // Some stateless MCP servers skip initialize and answer tools/list directly
  }

  const listRes = await sendMcpJsonRpc({
    ...params,
    method: 'tools/list',
    rpcParams: {},
  });

  if (listRes.error) {
    const msg = (listRes.error as { message?: string }).message ?? 'tools/list failed';
    throw new Error(msg);
  }

  const rawTools = ((listRes.result as { tools?: unknown[] } | undefined)?.tools ?? []) as Array<{
    name?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;

  const tools: McpTool[] = rawTools
    .filter((t) => Boolean(t.name))
    .slice(0, 50)
    .map((t) => ({
      name: String(t.name),
      description: String(t.description ?? 'No description provided'),
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      enabled: true,
    }));

  return { serverName, tools };
}

export async function callMcpTool(params: {
  endpointUrl: string;
  authHeaderName?: string;
  authToken?: string;
  toolName: string;
  args: Record<string, unknown>;
  serverBaseUrl: string;
}): Promise<unknown> {
  const rpcRes = await sendMcpJsonRpc({
    endpointUrl: params.endpointUrl,
    authHeaderName: params.authHeaderName,
    authToken: params.authToken,
    method: 'tools/call',
    rpcParams: {
      name: params.toolName,
      arguments: params.args,
    },
    serverBaseUrl: params.serverBaseUrl,
  });

  if (rpcRes.error) {
    const msg = (rpcRes.error as { message?: string }).message ?? 'MCP tool call failed';
    throw new Error(msg);
  }

  const result = rpcRes.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  if (result?.content && Array.isArray(result.content)) {
    const joined = result.content.map((c) => c.text ?? JSON.stringify(c)).join('\n');
    try {
      return JSON.parse(joined);
    } catch {
      return joined;
    }
  }
  return result ?? {};
}
