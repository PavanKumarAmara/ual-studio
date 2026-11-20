import dns from 'dns/promises';
import { Client } from 'pg';
import {
  chunkText,
  estimateTokens,
  extractHtmlToKnowledge,
  isBlockedHostOrIp,
  parseCsvToMarkdown,
  parseJsonToMarkdown,
  parseS3XmlListing,
  parseSitemapIndexXml,
  parseSitemapXml,
  scoreUrlPriority,
  validatePostgresUri,
  validateS3PublicUrl,
  validateWebsiteUrl,
} from '../src/utils/ingestion.ts';
import { embedTexts, extractPdfTextWithGemini } from './gemini.ts';

export interface IngestedChunkPayload {
  sourceName: string;
  content: string;
  tokenEstimate: number;
  embedding: number[];
}

export interface ConnectorResult {
  name: string;
  configSummary: string;
  summary: string;
  chunks: IngestedChunkPayload[];
}

const INDEXABLE_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.pdf', '.xml', '.log', '.html']);

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

export async function ingestFlatFile(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}): Promise<ConnectorResult> {
  const ext = getExt(file.originalname);
  let extractedText = '';

  if (ext === '.pdf' || file.mimetype === 'application/pdf') {
    extractedText = await extractPdfTextWithGemini(file.buffer.toString('base64'), file.originalname);
  } else {
    const raw = file.buffer.toString('utf-8');
    if (ext === '.csv') {
      extractedText = parseCsvToMarkdown(raw, file.originalname);
    } else if (ext === '.json') {
      extractedText = parseJsonToMarkdown(raw, file.originalname);
    } else {
      extractedText = raw;
    }
  }

  const rawChunks = chunkText(extractedText, 1100, 140).slice(0, 40);
  if (rawChunks.length === 0) {
    throw new Error(`No readable text could be extracted from ${file.originalname}.`);
  }

  const embeddings = await embedTexts(rawChunks);
  const chunks: IngestedChunkPayload[] = rawChunks.map((content, idx) => ({
    sourceName: file.originalname,
    content,
    tokenEstimate: estimateTokens(content),
    embedding: embeddings[idx] ?? [],
  }));

  const kb = (file.size / 1024).toFixed(1);
  return {
    name: file.originalname,
    configSummary: `${ext.replace('.', '').toUpperCase() || 'TEXT'} upload · ${kb} KB`,
    summary: `Extracted ${chunks.length} semantic chunks (${chunks.reduce((a, b) => a + b.tokenEstimate, 0)} tokens) from ${file.originalname}.`,
    chunks,
  };
}

export async function ingestPostgresSource(params: {
  uri: string;
  tableFilter?: string;
  useSampleSchema?: boolean;
}): Promise<ConnectorResult> {
  if (params.useSampleSchema) {
    const sampleDocs = [
      {
        sourceName: 'sample_warehouse (PostgreSQL) · public.warehouses',
        content:
          'PostgreSQL Table public.warehouses (warehouse_id TEXT PRIMARY KEY, city TEXT, cold_storage_capacity_pallets INT, operating_hours TEXT, cutoff_utc TEXT). Sample rows: WH-RTM | Rotterdam | 4200 pallets | 06:00-22:00 CET | 18:00Z cutoff; WH-EWR | Newark | 3100 pallets | 24/7 | 21:00Z cutoff; WH-SIN | Singapore | 5400 pallets | 24/7 | 14:00Z cutoff.',
      },
      {
        sourceName: 'sample_warehouse (PostgreSQL) · public.carrier_tariffs',
        content:
          'PostgreSQL Table public.carrier_tariffs (corridor TEXT, mode TEXT, base_rate_usd NUMERIC, fuel_surcharge_pct NUMERIC, transit_hours INT). Sample rows: US-EAST->EU-WEST | Express Air | $4.85/kg | 12.5% | 20h; EU-CENTRAL->US-EAST | Cold-Chain Air | $5.40/kg | 13.0% | 22h; APAC->EU-NORTH | Ocean Reefer | $3,850/FEU | 9.5% | 528h.',
      },
    ];
    const embeddings = await embedTexts(sampleDocs.map((d) => d.content));
    return {
      name: 'sample_warehouse (PostgreSQL Sample)',
      configSummary: 'Built-in read-only PostgreSQL sample schema · 2 tables',
      summary: 'Introspected 2 tables (public.warehouses, public.carrier_tariffs) with schema columns and sample rows.',
      chunks: sampleDocs.map((d, i) => ({
        sourceName: d.sourceName,
        content: d.content,
        tokenEstimate: estimateTokens(d.content),
        embedding: embeddings[i] ?? [],
      })),
    };
  }

  const check = validatePostgresUri(params.uri);
  if (!check.valid || !check.redacted) {
    throw new Error(check.error ?? 'Invalid PostgreSQL URI.');
  }

  const client = new Client({
    connectionString: params.uri.trim(),
    connectionTimeoutMillis: 5000,
    query_timeout: 8000,
    ssl: params.uri.includes('localhost') || params.uri.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name LIMIT 12`
    );

    const filterList = (params.tableFilter ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const targetTables = tablesRes.rows
      .map((r) => r.table_name)
      .filter((name) => (filterList.length === 0 ? true : filterList.includes(name.toLowerCase())))
      .slice(0, 6);

    if (targetTables.length === 0) {
      throw new Error('Connected to PostgreSQL, but no matching tables were found in the public schema.');
    }

    const dbName = new URL(params.uri.trim()).pathname.replace(/^\//, '') || 'postgres';
    const rawDocs: Array<{ sourceName: string; content: string }> = [];

    for (const table of targetTables) {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
      const colsRes = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [table]
      );
      const colSchema = colsRes.rows
        .map((c) => `${c.column_name} (${c.data_type}${c.is_nullable === 'NO' ? ', NOT NULL' : ''})`)
        .join(', ');

      const sampleRes = await client.query(`SELECT * FROM "public"."${table}" LIMIT 15`);
      const sampleLines = sampleRes.rows.map((row, i) => {
        const kv = Object.entries(row as Record<string, unknown>)
          .slice(0, 12)
          .map(([k, v]) => `${k}=${v === null || v === undefined ? 'NULL' : String(v).slice(0, 120)}`)
          .join(' | ');
        return `Row ${i + 1}: ${kv}`;
      });

      const docText = [
        `PostgreSQL Table: public.${table} (database: ${dbName})`,
        `Columns: ${colSchema}`,
        `Sample rows indexed (${sampleRes.rows.length}):`,
        ...sampleLines,
      ].join('\n');

      for (const piece of chunkText(docText, 1200, 120)) {
        rawDocs.push({
          sourceName: `${dbName} (PostgreSQL) · public.${table}`,
          content: piece,
        });
      }
    }

    const embeddings = await embedTexts(rawDocs.map((d) => d.content));
    return {
      name: `${dbName} (PostgreSQL)`,
      configSummary: check.redacted,
      summary: `Introspected ${targetTables.length} public tables (${targetTables.join(', ')}) in read-only mode and indexed ${rawDocs.length} chunks.`,
      chunks: rawDocs.map((d, i) => ({
        sourceName: d.sourceName,
        content: d.content,
        tokenEstimate: estimateTokens(d.content),
        embedding: embeddings[i] ?? [],
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to connect to PostgreSQL host.';
    throw new Error(`PostgreSQL connection failed: ${msg}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function ingestPublicS3Folder(params: {
  folderUrl: string;
  useSampleBucket?: boolean;
}): Promise<ConnectorResult> {
  if (params.useSampleBucket) {
    const sampleDocs = [
      {
        sourceName: 'S3: public-kb/returns-and-claims.md',
        content:
          'Freight Damage & Claims Policy (Public S3): Claims for concealed damage must be filed within 7 calendar days of signed Proof of Delivery (POD). Visible container damage must be noted directly on the Bill of Lading at handoff. Claims under $2,500 settle automatically within 5 business days.',
      },
      {
        sourceName: 'S3: public-kb/hazmat-lithium-rules.md',
        content:
          'Lithium-Ion Air Freight Compliance (UN3480 / UN3481): State of charge must not exceed 30% for standalone lithium-ion cells shipped by air. Packages require IATA Section IB Class 9 hazard labels and shipper Dangerous Goods Declaration (DGD) uploaded 12 hours prior to departure.',
      },
    ];
    const embeddings = await embedTexts(sampleDocs.map((d) => d.content));
    return {
      name: 'public-kb (S3 Sample Folder)',
      configSummary: 'Built-in sample public S3 folder · 2 Markdown documents',
      summary: 'Crawled 2 documents (returns-and-claims.md, hazmat-lithium-rules.md) and indexed 2 chunks.',
      chunks: sampleDocs.map((d, i) => ({
        sourceName: d.sourceName,
        content: d.content,
        tokenEstimate: estimateTokens(d.content),
        embedding: embeddings[i] ?? [],
      })),
    };
  }

  const check = validateS3PublicUrl(params.folderUrl);
  if (!check.valid || !check.listUrl || !check.baseUrl) {
    throw new Error(check.error ?? 'Invalid public S3 folder URL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let xml = '';
  try {
    const res = await fetch(check.listUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Bucket listing returned HTTP ${res.status}. Ensure the S3 folder has public ListBucket access.`);
    }
    xml = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const listed = parseS3XmlListing(xml, check.baseUrl).filter(
    (obj) => INDEXABLE_EXTENSIONS.has(getExt(obj.key)) && obj.size <= 512 * 1024
  );

  if (listed.length === 0) {
    throw new Error(
      'Public S3 folder listed successfully, but no indexable text files (.md, .txt, .csv, .json, .pdf) under 512KB were found under this prefix.'
    );
  }

  const targetFiles = listed.slice(0, 8);
  const rawDocs: Array<{ sourceName: string; content: string }> = [];

  await Promise.allSettled(
    targetFiles.map(async (obj) => {
      try {
        const fileRes = await fetch(obj.url);
        if (!fileRes.ok) return;
        const ext = getExt(obj.key);
        let text = '';
        if (ext === '.pdf') {
          const arrBuf = await fileRes.arrayBuffer();
          text = await extractPdfTextWithGemini(Buffer.from(arrBuf).toString('base64'), obj.key);
        } else {
          const raw = await fileRes.text();
          if (ext === '.csv') text = parseCsvToMarkdown(raw, obj.key);
          else if (ext === '.json') text = parseJsonToMarkdown(raw, obj.key);
          else text = raw;
        }

        for (const piece of chunkText(text, 1100, 140).slice(0, 10)) {
          rawDocs.push({
            sourceName: `S3: ${obj.key}`,
            content: piece,
          });
        }
      } catch {
        // Continue crawling remaining public objects
      }
    })
  );

  if (rawDocs.length === 0) {
    throw new Error('Could not download or parse any files from the public S3 folder.');
  }

  const embeddings = await embedTexts(rawDocs.map((d) => d.content));
  const parsedUrl = new URL(params.folderUrl.trim());
  const bucketLabel = parsedUrl.hostname.split('.')[0] || 's3-bucket';

  return {
    name: `${bucketLabel} (Public S3)`,
    configSummary: params.folderUrl.trim().slice(0, 500),
    summary: `Crawled ${targetFiles.length} public S3 objects under "${check.prefix || '/'}" and indexed ${rawDocs.length} chunks.`,
    chunks: rawDocs.map((d, i) => ({
      sourceName: d.sourceName,
      content: d.content,
      tokenEstimate: estimateTokens(d.content),
      embedding: embeddings[i] ?? [],
    })),
  };
}

async function assertPublicDnsResolution(hostname: string): Promise<void> {
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isBlockedHostOrIp(rec.address)) {
        throw new Error('Target domain resolves to a private or internal IP address and is blocked.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('blocked')) {
      throw err;
    }
    throw new Error(`Could not resolve domain "${hostname}". Check the URL and try again.`);
  }
}

async function fetchTextWithCap(url: string, timeoutMs = 5000, maxBytes = 1_500_000): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  finalUrl: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; UAL-KnowledgeCrawler/1.1; +https://ual.cloud)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const finalParsed = new URL(res.url || url);
    if (isBlockedHostOrIp(finalParsed.hostname)) {
      throw new Error('Redirect to a private or internal network host was blocked.');
    }
    const contentType = String(res.headers.get('content-type') ?? '').toLowerCase();
    const raw = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      text: raw.slice(0, maxBytes),
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverSitemapUrls(origin: string, hostname: string, limit: number): Promise<string[]> {
  try {
    const sitemapRes = await fetchTextWithCap(`${origin}/sitemap.xml`, 2500, 500_000);
    if (!sitemapRes.ok || !sitemapRes.text.includes('<loc>')) return [];

    // Support <sitemapindex> pointing to child sitemaps (e.g. page-sitemap.xml)
    const childSitemaps = parseSitemapIndexXml(sitemapRes.text, hostname, 2);
    if (childSitemaps.length > 0) {
      const results = await Promise.allSettled(
        childSitemaps.map((smUrl) => fetchTextWithCap(smUrl, 2500, 500_000))
      );
      const combined: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok && r.value.text.includes('<loc>')) {
          combined.push(...parseSitemapXml(r.value.text, hostname, limit * 2));
        }
      }
      return Array.from(new Set(combined))
        .sort((a, b) => scoreUrlPriority(b) - scoreUrlPriority(a))
        .slice(0, limit);
    }

    return parseSitemapXml(sitemapRes.text, hostname, limit);
  } catch {
    return [];
  }
}

function canonicalUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const cleanPath = u.pathname.replace(/\/$/, '') || '/';
    return `${host}${cleanPath}`;
  } catch {
    return rawUrl.replace(/\/$/, '');
  }
}

export async function ingestWebsiteSource(params: {
  url: string;
  additionalUrls?: string[];
  maxPages?: number;
  useSampleWebsite?: boolean;
}): Promise<ConnectorResult> {
  if (params.useSampleWebsite) {
    const samplePages = [
      {
        sourceName: 'Product Overview (https://meridianfreight.example.com/)',
        content:
          'Page Title: Meridian Cold-Chain Logistics — Product Overview\nSource URL: https://meridianfreight.example.com/\nMeridian provides temperature-controlled air and ocean freight across 42 global corridors with continuous IoT telemetry (2°C to 8°C pharma range and -20°C frozen cargo). Customers receive automated exception alerts within 15 minutes of any thermal excursion.',
      },
      {
        sourceName: 'Pricing & Enterprise SLAs (https://meridianfreight.example.com/pricing)',
        content:
          'Page Title: Pricing & Enterprise SLAs\nSource URL: https://meridianfreight.example.com/pricing\nStandard Commercial accounts include 4-hour customs broker support and online portal tracking. Enterprise Cold-Chain plans include dedicated customs pre-clearance, 99.9% thermal compliance guarantee, automated claims settlement under $2,500 within 5 business days, and webhook/MCP integration access.',
      },
      {
        sourceName: 'Security & Customs FAQ (https://meridianfreight.example.com/faq)',
        content:
          'Page Title: Security & Customs FAQ\nSource URL: https://meridianfreight.example.com/faq\nGDP and ISO 9001 certified handling facilities in Rotterdam, Newark, Frankfurt, and Singapore. Commercial invoices, Packing Lists, and GDP Cold-Chain Certificates must be submitted at least 6 hours before flight departure for EU customs pre-clearance.',
      },
    ];
    const embeddings = await embedTexts(samplePages.map((p) => p.content), 4000);
    return {
      name: 'meridianfreight.example.com (Sample Website)',
      configSummary: 'Built-in 3-page sample business website · Overview, Pricing, FAQ',
      summary: 'Scraped 3 public pages (Overview, Pricing & SLAs, Security FAQ) and indexed 3 semantic chunks.',
      chunks: samplePages.map((p, i) => ({
        sourceName: p.sourceName,
        content: p.content,
        tokenEstimate: estimateTokens(p.content),
        embedding: embeddings[i] ?? [],
      })),
    };
  }

  const check = validateWebsiteUrl(params.url);
  if (!check.valid || !check.normalizedUrl || !check.origin || !check.hostname) {
    throw new Error(check.error ?? 'Invalid website URL.');
  }

  await assertPublicDnsResolution(check.hostname);

  const pageCap = Math.min(12, Math.max(1, Number(params.maxPages ?? 5) || 5));
  const pinnedUrls: string[] = [check.normalizedUrl];
  const validatedExtraHosts = new Set<string>([check.hostname]);

  // Validate and pin user-specified priority URLs (full URLs or relative paths like /pricing, /faq)
  for (const rawExtra of (params.additionalUrls ?? []).slice(0, 8)) {
    const trimmed = String(rawExtra ?? '').trim();
    if (!trimmed) continue;
    const candidateStr = trimmed.startsWith('/')
      ? `${check.origin}${trimmed}`
      : trimmed;
    const extraCheck = validateWebsiteUrl(candidateStr);
    if (!extraCheck.valid || !extraCheck.normalizedUrl || !extraCheck.hostname) continue;
    if (!validatedExtraHosts.has(extraCheck.hostname)) {
      try {
        await assertPublicDnsResolution(extraCheck.hostname);
        validatedExtraHosts.add(extraCheck.hostname);
      } catch {
        continue;
      }
    }
    if (!pinnedUrls.some((u) => canonicalUrlKey(u) === canonicalUrlKey(extraCheck.normalizedUrl!))) {
      pinnedUrls.push(extraCheck.normalizedUrl);
    }
  }

  // Only scope to a pathPrefix if the user explicitly passed a deep documentation section (e.g. /docs/...)
  const entryParsed = new URL(check.normalizedUrl);
  const pathPrefix =
    /^\/(docs|documentation|help|kb|guides|api)(\/|$)/i.test(entryParsed.pathname)
      ? entryParsed.pathname.replace(/\/$/, '')
      : '';

  const visited = new Set<string>();
  const queuedKeys = new Set<string>();
  const priorityQueue: Array<{ url: string; priority: number }> = [];

  const enqueue = (url: string, priorityBoost = 0) => {
    const key = canonicalUrlKey(url);
    if (visited.has(key) || queuedKeys.has(key)) return;
    queuedKeys.add(key);
    priorityQueue.push({ url, priority: scoreUrlPriority(url) + priorityBoost });
  };

  // Pin entry URL + user-provided priority URLs first
  pinnedUrls.forEach((u, idx) => enqueue(u, 1000 - idx * 5));

  // Fetch entry page AND sitemap.xml in parallel to minimize latency
  const [entryFetchResult, sitemapUrls] = await Promise.all([
    fetchTextWithCap(check.normalizedUrl, 5500, 1_500_000).catch((err) => ({
      ok: false as const,
      status: 0,
      contentType: '',
      text: '',
      finalUrl: check.normalizedUrl!,
      error: err instanceof Error ? err.message : 'Failed to fetch URL',
    })),
    pageCap > 1 ? discoverSitemapUrls(check.origin, check.hostname, pageCap * 3) : Promise.resolve([]),
  ]);

  const rawDocs: Array<{ sourceName: string; content: string }> = [];
  const scrapedUrls: string[] = [];
  let firstError = '';
  let jsShellCount = 0;

  const processPage = (res: {
    ok: boolean;
    status: number;
    contentType: string;
    text: string;
    finalUrl: string;
    error?: string;
  }, requestedUrl: string) => {
    if (!res.ok) {
      if (!firstError) {
        firstError = res.error ?? `HTTP ${res.status} when fetching ${requestedUrl}`;
      }
      return;
    }
    if (
      res.contentType &&
      !res.contentType.includes('text/html') &&
      !res.contentType.includes('text/plain') &&
      !res.contentType.includes('application/xhtml')
    ) {
      return;
    }

    const extracted = extractHtmlToKnowledge(res.text, res.finalUrl);
    if (extracted.isJsShell) {
      jsShellCount += 1;
    }

    if (extracted.text.length >= 60) {
      scrapedUrls.push(res.finalUrl);
      const sourceLabel = `${extracted.title.slice(0, 56)} (${res.finalUrl})`.slice(0, 118);
      for (const piece of chunkText(extracted.text, 1100, 140).slice(0, 8)) {
        rawDocs.push({
          sourceName: sourceLabel,
          content: piece,
        });
      }
    }

    for (const link of extracted.links) {
      if (pathPrefix && !new URL(link).pathname.startsWith(pathPrefix)) continue;
      enqueue(link, 0);
    }
  };

  // Mark entry URL visited and process initial fetch
  visited.add(canonicalUrlKey(check.normalizedUrl));
  if (entryFetchResult.finalUrl) {
    visited.add(canonicalUrlKey(entryFetchResult.finalUrl));
  }
  // Remove entry URL from queue since we already fetched it
  const entryIdx = priorityQueue.findIndex(
    (item) => canonicalUrlKey(item.url) === canonicalUrlKey(check.normalizedUrl!)
  );
  if (entryIdx >= 0) priorityQueue.splice(entryIdx, 1);

  processPage(entryFetchResult, check.normalizedUrl);

  // Merge sitemap URLs (already priority-sorted so pricing/plans/FAQ rise to the top)
  for (const smUrl of sitemapUrls) {
    if (pathPrefix && !new URL(smUrl).pathname.startsWith(pathPrefix)) continue;
    enqueue(smUrl, 10);
  }

  // Proactive fallback: if crawling a root site and no pricing page was discovered yet, probe /pricing
  if (pageCap > 1 && !pathPrefix) {
    const resolvedOrigin = entryFetchResult.ok
      ? new URL(entryFetchResult.finalUrl).origin
      : check.origin;
    const hasPricingCandidate = Array.from(queuedKeys).some((k) =>
      /\/(pricing|plans|packages)\b/i.test(k)
    );
    if (!hasPricingCandidate) {
      enqueue(`${resolvedOrigin}/pricing`, -5);
    }
  }

  // Concurrent priority-first crawl loop (up to 4 parallel requests per wave)
  const CONCURRENCY = 4;
  while (priorityQueue.length > 0 && scrapedUrls.length < pageCap && rawDocs.length < 36) {
    priorityQueue.sort((a, b) => b.priority - a.priority);
    const remaining = Math.max(1, pageCap - scrapedUrls.length);
    const batchSize = Math.min(CONCURRENCY, remaining, priorityQueue.length);
    const wave: string[] = [];

    while (wave.length < batchSize && priorityQueue.length > 0) {
      const next = priorityQueue.shift()!;
      const key = canonicalUrlKey(next.url);
      if (visited.has(key)) continue;
      visited.add(key);
      wave.push(next.url);
    }

    if (wave.length === 0) break;

    const results = await Promise.allSettled(
      wave.map(async (url) => ({
        url,
        res: await fetchTextWithCap(url, 5000, 1_500_000),
      }))
    );

    for (const outcome of results) {
      if (scrapedUrls.length >= pageCap || rawDocs.length >= 36) break;
      if (outcome.status === 'fulfilled') {
        const finalKey = canonicalUrlKey(outcome.value.res.finalUrl);
        visited.add(finalKey);
        processPage(outcome.value.res, outcome.value.url);
      } else if (!firstError) {
        firstError =
          outcome.reason instanceof Error ? outcome.reason.message : 'Page fetch failed';
      }
    }
  }

  if (rawDocs.length === 0) {
    throw new Error(
      firstError
        ? `Unable to scrape readable text from website: ${firstError}`
        : 'No readable HTML content was found at that URL. Sites that require client-side JavaScript rendering or block crawlers may return empty HTML.'
    );
  }

  const boundedDocs = rawDocs.slice(0, 36);
  const embeddings = await embedTexts(boundedDocs.map((d) => d.content), 6000);
  const jsNote =
    jsShellCount > 0
      ? ` (${jsShellCount} page${jsShellCount > 1 ? 's' : ''} appeared client-rendered—add direct URLs like /pricing or upload a PDF/CSV if dynamic tables were omitted.)`
      : '';

  return {
    name: `${check.hostname} (Website)`,
    configSummary: check.normalizedUrl.slice(0, 500),
    summary: `Scraped ${scrapedUrls.length} priority page${scrapedUrls.length > 1 ? 's' : ''} from ${check.hostname} and indexed ${boundedDocs.length} chunks.${jsNote}`,
    chunks: boundedDocs.map((d, i) => ({
      sourceName: d.sourceName,
      content: d.content,
      tokenEstimate: estimateTokens(d.content),
      embedding: embeddings[i] ?? [],
    })),
  };
}


