import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  FileUp,
  FolderOpen,
  Globe,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import type { DataSource, KnowledgeChunk, Project, SourceType } from '../types';

interface ConnectorsTabProps {
  project: Project;
  sources: DataSource[];
  chunks: KnowledgeChunk[];
  onSourceIngested: (payload: {
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
  }) => Promise<void>;
}

const CONNECTOR_OPTIONS: Array<{
  id: SourceType;
  label: string;
  shortLabel: string;
  tagline: string;
  securityNote: string;
  icon: typeof Globe;
}> = [
  {
    id: 'website',
    label: 'Website URL',
    shortLabel: 'Website',
    tagline: 'Scrape docs, pricing & FAQ pages',
    securityNote: 'SSRF-protected · sitemap.xml + same-domain crawl',
    icon: Globe,
  },
  {
    id: 'flatfile',
    label: 'Flat Files',
    shortLabel: 'Flat File',
    tagline: 'Upload CSV, MD, TXT, JSON or PDF',
    securityNote: 'Up to 8 MB · Gemini multimodal PDF extraction',
    icon: FileUp,
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    shortLabel: 'PostgreSQL',
    tagline: 'Introspect read-only schemas & rows',
    securityNote: 'Read-only transaction · credentials never stored',
    icon: Database,
  },
  {
    id: 's3_public',
    label: 'Public S3 Folder',
    shortLabel: 'Public S3',
    tagline: 'Crawl public bucket prefix objects',
    securityNote: 'ListObjectsV2 · indexes MD, TXT, CSV, JSON & PDF',
    icon: FolderOpen,
  },
];

function getSourceMeta(sourceType: SourceType) {
  return CONNECTOR_OPTIONS.find((opt) => opt.id === sourceType) ?? CONNECTOR_OPTIONS[1];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ConnectorsTab({
  project,
  sources,
  chunks,
  onSourceIngested,
}: ConnectorsTabProps) {
  const [activeConnector, setActiveConnector] = useState<SourceType>('website');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<'all' | SourceType>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Flat file state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // PostgreSQL state
  const [pgUri, setPgUri] = useState('');
  const [pgTables, setPgTables] = useState('');

  // Public S3 state
  const [s3Url, setS3Url] = useState('');

  // Website URL state
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteExtraUrls, setWebsiteExtraUrls] = useState('');
  const [websiteMaxPages, setWebsiteMaxPages] = useState<number>(6);
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

  // Chunk search
  const [chunkSearch, setChunkSearch] = useState('');

  const sourceCountsByType = useMemo(() => {
    const counts: Record<SourceType, number> = {
      website: 0,
      flatfile: 0,
      postgres: 0,
      s3_public: 0,
    };
    for (const s of sources) {
      if (s.sourceType in counts) {
        counts[s.sourceType] += 1;
      }
    }
    return counts;
  }, [sources]);

  const totalTokens = useMemo(
    () => chunks.reduce((sum, c) => sum + (Number(c.tokenEstimate) || 0), 0),
    [chunks]
  );

  const activeMeta = getSourceMeta(activeConnector);

  const handleSelectConnector = (type: SourceType) => {
    setActiveConnector(type);
    setError('');
    setSuccessMsg('');
  };

  const handleFlatFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!selectedFile) {
      setError('Choose a .csv, .md, .txt, .json, or .pdf file to index.');
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('projectName', project.name);

      const res = await fetch('/api/ingest/flatfile', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload ingestion failed.');

      await onSourceIngested({
        sourceType: 'flatfile',
        name: data.name,
        configSummary: data.configSummary,
        summary: data.summary,
        knowledgeBrief: data.knowledgeBrief,
        chunks: data.chunks,
      });
      setSelectedFile(null);
      setSuccessMsg(`Indexed "${data.name}" (${data.chunks.length} chunks added).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Flat-file ingestion failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePostgresSubmit = async (e: React.FormEvent, useSampleSchema = false) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!useSampleSchema && !pgUri.trim()) {
      setError('Enter a read-only PostgreSQL URI (postgresql://user:pass@host:5432/dbname).');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/ingest/postgres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri: pgUri.trim(),
          tableFilter: pgTables.trim(),
          projectName: project.name,
          useSampleSchema,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PostgreSQL introspection failed.');

      await onSourceIngested({
        sourceType: 'postgres',
        name: data.name,
        configSummary: data.configSummary,
        summary: data.summary,
        knowledgeBrief: data.knowledgeBrief,
        chunks: data.chunks,
      });
      setPgUri('');
      setPgTables('');
      setSuccessMsg(`Connected and indexed "${data.name}" (${data.chunks.length} chunks added).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PostgreSQL connector failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleS3Submit = async (e: React.FormEvent, useSampleBucket = false) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!useSampleBucket && !s3Url.trim()) {
      setError('Enter a public S3 folder URL (e.g. https://bucket.s3.us-east-1.amazonaws.com/docs/).');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/ingest/s3-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: s3Url.trim(),
          projectName: project.name,
          useSampleBucket,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Public S3 folder crawl failed.');

      await onSourceIngested({
        sourceType: 's3_public',
        name: data.name,
        configSummary: data.configSummary,
        summary: data.summary,
        knowledgeBrief: data.knowledgeBrief,
        chunks: data.chunks,
      });
      setS3Url('');
      setSuccessMsg(`Crawled and indexed "${data.name}" (${data.chunks.length} chunks added).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Public S3 connector failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleWebsiteSubmit = async (
    e: React.FormEvent,
    opts?: { useSampleWebsite?: boolean; overrideUrl?: string; sourceId?: string }
  ) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    const targetUrl = (opts?.overrideUrl ?? websiteUrl).trim();
    if (!opts?.useSampleWebsite && !targetUrl) {
      setError('Enter a public business website or docs URL (e.g. https://docs.yourcompany.com).');
      return;
    }

    setBusy(true);
    if (opts?.sourceId) setRecrawlingId(opts.sourceId);
    const t0 = performance.now();
    try {
      const parsedAdditionalUrls = opts?.overrideUrl
        ? []
        : websiteExtraUrls
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);

      const res = await fetch('/api/ingest/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          additionalUrls: parsedAdditionalUrls,
          maxPages: websiteMaxPages,
          projectName: project.name,
          useSampleWebsite: Boolean(opts?.useSampleWebsite),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Website scraping failed.');

      await onSourceIngested({
        sourceType: 'website',
        name: data.name,
        configSummary: data.configSummary,
        summary: data.summary,
        knowledgeBrief: data.knowledgeBrief,
        chunks: data.chunks,
      });
      const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);
      if (!opts?.overrideUrl) {
        setWebsiteUrl('');
        setWebsiteExtraUrls('');
      }
      setSuccessMsg(`Scraped and indexed "${data.name}" (${data.chunks.length} chunks in ${elapsedSec}s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Website connector failed.');
    } finally {
      setBusy(false);
      setRecrawlingId(null);
    }
  };

  const filteredSources = useMemo(() => {
    if (sourceTypeFilter === 'all') return sources;
    return sources.filter((s) => s.sourceType === sourceTypeFilter);
  }, [sources, sourceTypeFilter]);

  const filteredChunks = useMemo(() => {
    if (!chunkSearch.trim()) return chunks;
    const q = chunkSearch.toLowerCase();
    return chunks.filter(
      (c) => c.sourceName.toLowerCase().includes(q) || c.content.toLowerCase().includes(q)
    );
  }, [chunks, chunkSearch]);

  return (
    <div className="space-y-6">
      {/* Knowledge Brief + Index Summary Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-2">
            <h1 className="text-lg font-semibold text-slate-900">Synthesized Knowledge Brief</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {project.knowledgeBrief ||
                'Scrape your business website URL, upload documents, introspect a PostgreSQL database, or crawl a public S3 folder below. Unified Agentic Layer (UAL) parses, chunks, embeds, and builds a unified retrieval index automatically.'}
            </p>
          </div>
          <div className="lg:col-span-4 grid grid-cols-3 gap-2.5">
            <div className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2.5">
              <p className="text-[11px] font-medium text-slate-500">Sources</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {sources.length}
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2.5">
              <p className="text-[11px] font-medium text-slate-500">Chunks</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {chunks.length}
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2.5">
              <p className="text-[11px] font-medium text-slate-500">Est. Tokens</p>
              <p className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Connector Studio */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Connect & Index Data Source</h2>
          <p className="text-xs text-slate-500 mt-1">
            Choose a connector below. Every source flows into the same hybrid vector + lexical knowledge index for this assistant.
          </p>
        </div>

        <div className="p-6 space-y-5">
          {/* Structured 4-Column Connector Picker */}
          <div
            role="tablist"
            aria-label="Data source connectors"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            {CONNECTOR_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = activeConnector === opt.id;
              const count = sourceCountsByType[opt.id];
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => handleSelectConnector(opt.id)}
                  className={`group text-left p-4 rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600/15'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200/70 group-hover:text-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    {count > 0 && (
                      <span className="text-[11px] font-mono tabular-nums text-slate-500">
                        {count} active
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-3 text-sm font-semibold ${
                      isSelected ? 'text-slate-950' : 'text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 leading-snug">{opt.tagline}</p>
                </button>
              );
            })}
          </div>

          {/* Feedback Banners */}
          {error && (
            <div
              role="alert"
              className="px-4 py-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg"
            >
              {error}
            </div>
          )}
          {successMsg && (
            <div
              role="status"
              className="px-4 py-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Active Connector Configuration Panel */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <activeMeta.icon className="w-4 h-4 text-blue-600" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Configure {activeMeta.label}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                {activeMeta.securityNote}
              </span>
            </div>

            {activeConnector === 'website' && (
              <form onSubmit={(e) => handleWebsiteSubmit(e)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="md:col-span-3 space-y-1.5">
                    <label
                      htmlFor="website-url-input"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Business Website or Documentation URL
                    </label>
                    <input
                      id="website-url-input"
                      type="text"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://docs.yourcompany.com or https://yourcompany.com/pricing"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="website-max-pages"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Max Pages to Crawl
                    </label>
                    <select
                      id="website-max-pages"
                      value={websiteMaxPages}
                      onChange={(e) => setWebsiteMaxPages(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                    >
                      <option value={1}>1 page (URL only)</option>
                      <option value={3}>Up to 3 pages</option>
                      <option value={6}>Up to 6 pages</option>
                      <option value={10}>Up to 10 pages</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="website-extra-urls"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Priority Pages to Include (optional — comma or newline separated)
                  </label>
                  <input
                    id="website-extra-urls"
                    type="text"
                    value={websiteExtraUrls}
                    onChange={(e) => setWebsiteExtraUrls(e.target.value)}
                    placeholder="/pricing, /plans, /faq or full URLs like https://docs.yourcompany.com/pricing"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Crawls concurrently and automatically prioritizes <code className="font-mono">/pricing</code>, <code className="font-mono">/plans</code>, <code className="font-mono">/features</code>, <code className="font-mono">/faq</code>, and <code className="font-mono">/docs</code> across sitemaps (including sitemap indexes), pricing tables, and JSON-LD structured data while blocking private network hosts.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Scraping & Indexing...' : 'Scrape & Index Website'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => handleWebsiteSubmit(e, { useSampleWebsite: true })}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Index Built-in Sample Website
                  </button>
                </div>
              </form>
            )}

            {activeConnector === 'flatfile' && (
              <form onSubmit={handleFlatFileSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="flatfile-upload"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Upload Document (.csv, .md, .txt, .json, .pdf — max 8 MB)
                  </label>
                  <label
                    htmlFor="flatfile-upload"
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        {selectedFile ? (
                          <FileText className="w-4 h-4 text-blue-600" aria-hidden="true" />
                        ) : (
                          <UploadCloud className="w-4 h-4" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">
                          {selectedFile ? selectedFile.name : 'Choose a file to upload and index'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {selectedFile
                            ? `${formatBytes(selectedFile.size)} · Ready to analyze`
                            : 'Supported formats: CSV, Markdown, TXT, JSON, PDF'}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md shrink-0">
                      {selectedFile ? 'Change File' : 'Browse Files'}
                    </span>
                    <input
                      id="flatfile-upload"
                      type="file"
                      accept=".csv,.md,.txt,.json,.pdf"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      className="sr-only"
                    />
                  </label>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    CSV and JSON files are normalized into structured knowledge rows; PDFs are parsed via Gemini multimodal extraction.
                  </p>
                </div>
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Analyzing & Indexing...' : 'Analyze & Index File'}
                  </button>
                </div>
              </form>
            )}

            {activeConnector === 'postgres' && (
              <form onSubmit={(e) => handlePostgresSubmit(e, false)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label htmlFor="pg-uri" className="block text-xs font-medium text-slate-700">
                      Read-Only PostgreSQL URI
                    </label>
                    <input
                      id="pg-uri"
                      type="text"
                      value={pgUri}
                      onChange={(e) => setPgUri(e.target.value)}
                      placeholder="postgresql://readonly_user:password@db.company.com:5432/analytics"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="pg-tables" className="block text-xs font-medium text-slate-700">
                      Tables Filter (optional, comma-separated)
                    </label>
                    <input
                      id="pg-tables"
                      type="text"
                      value={pgTables}
                      onChange={(e) => setPgTables(e.target.value)}
                      placeholder="e.g. orders, products"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Connects with <code className="font-mono">SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY</code>, introspects <code className="font-mono">information_schema</code>, and indexes table schemas + sample rows. Passwords are never persisted.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Introspecting Schema...' : 'Connect & Introspect Postgres'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => handlePostgresSubmit(e, true)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Index Built-in Sample Postgres Schema
                  </button>
                </div>
              </form>
            )}

            {activeConnector === 's3_public' && (
              <form onSubmit={(e) => handleS3Submit(e, false)} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="s3-folder-url"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Public S3 Bucket / Folder URL
                  </label>
                  <input
                    id="s3-folder-url"
                    type="url"
                    value={s3Url}
                    onChange={(e) => setS3Url(e.target.value)}
                    placeholder="https://my-public-docs.s3.us-east-1.amazonaws.com/knowledge-base/"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Fetches S3 ListObjectsV2 XML under the specified prefix and indexes public Markdown, TXT, CSV, JSON, and PDF objects.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Crawling Public Folder...' : 'Crawl & Index S3 Folder'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => handleS3Submit(e, true)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Index Built-in Sample S3 Folder
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Connected Sources Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">Connected Sources</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {filteredSources.length}
              {sourceTypeFilter !== 'all' ? ` of ${sources.length}` : ''}
            </span>
          </div>

          {sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter connected sources by type">
              <button
                type="button"
                onClick={() => setSourceTypeFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  sourceTypeFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                All
              </button>
              {CONNECTOR_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSourceTypeFilter(opt.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    sourceTypeFilter === opt.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {opt.shortLabel}
                  {sourceCountsByType[opt.id] > 0 ? ` (${sourceCountsByType[opt.id]})` : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        {sources.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">No knowledge sources connected yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Select Website URL, Flat Files, PostgreSQL, or Public S3 Folder above to index your first knowledge source for this assistant.
            </p>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No {getSourceMeta(sourceTypeFilter as SourceType).shortLabel} sources connected yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-6">Source</th>
                  <th className="py-3 px-4">Connector</th>
                  <th className="py-3 px-4">Location / Origin</th>
                  <th className="py-3 px-4 text-right">Chunks</th>
                  <th className="py-3 px-6 text-right">Status & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredSources.map((src) => {
                  const meta = getSourceMeta(src.sourceType);
                  const Icon = meta.icon;
                  const isHttpUrl =
                    src.configSummary.startsWith('https://') ||
                    src.configSummary.startsWith('http://');
                  return (
                    <tr key={src.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200/80 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-4 h-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 leading-snug">{src.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                              {src.summary}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {meta.shortLabel}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-slate-600 max-w-[260px]">
                        {isHttpUrl ? (
                          <a
                            href={src.configSummary}
                            target="_blank"
                            rel="noreferrer"
                            title={src.configSummary}
                            className="inline-flex items-center gap-1 max-w-full text-slate-600 hover:text-blue-600 transition-colors"
                          >
                            <span className="truncate">{src.configSummary}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="block truncate" title={src.configSummary}>
                            {src.configSummary}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono tabular-nums text-slate-800 text-right whitespace-nowrap">
                        {src.chunkCount}
                      </td>
                      <td className="py-3.5 px-6 text-xs text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-3">
                          {src.sourceType === 'website' && isHttpUrl && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) =>
                                handleWebsiteSubmit(e, {
                                  overrideUrl: src.configSummary,
                                  sourceId: src.id,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200/80 rounded-md hover:bg-blue-100/70 disabled:opacity-50 transition-colors"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${recrawlingId === src.id ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                              Re-crawl
                            </button>
                          )}
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                src.status === 'indexed'
                                  ? 'bg-emerald-500'
                                  : src.status === 'error'
                                  ? 'bg-red-500'
                                  : 'bg-amber-500'
                              }`}
                              aria-hidden="true"
                            />
                            <span
                              className={
                                src.status === 'indexed'
                                  ? 'text-emerald-700'
                                  : src.status === 'error'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                              }
                            >
                              {src.status === 'indexed'
                                ? 'Indexed'
                                : src.status === 'error'
                                ? 'Error'
                                : 'Syncing'}
                            </span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Searchable Indexed Knowledge Chunks */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">Knowledge Index Explorer</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {filteredChunks.length} of {chunks.length} chunks
            </span>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Filter knowledge chunks"
              value={chunkSearch}
              onChange={(e) => setChunkSearch(e.target.value)}
              placeholder="Search indexed knowledge..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
          {filteredChunks.length === 0 ? (
            <div className="p-8 text-sm text-slate-500 text-center">
              {chunks.length === 0
                ? 'Indexed chunks will appear here once you connect a source above.'
                : 'No knowledge chunks match your search query.'}
            </div>
          ) : (
            filteredChunks.map((chunk) => (
              <div key={chunk.id} className="px-6 py-4 space-y-1.5 hover:bg-slate-50/40 transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-900 truncate max-w-[65%]">
                    {chunk.sourceName}
                  </span>
                  <span className="font-mono tabular-nums shrink-0 text-[11px]">
                    {chunk.tokenEstimate} tokens ·{' '}
                    {chunk.embedding.length > 0
                      ? `${chunk.embedding.length}d vector`
                      : 'lexical index'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {chunk.content}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
