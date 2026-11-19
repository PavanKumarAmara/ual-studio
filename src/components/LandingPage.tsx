import { useState } from 'react';
import { ArrowRight, Check, Code2, LogIn } from 'lucide-react';

interface LandingPageProps {
  authLoading: boolean;
  authError: string;
  onSignIn: () => void;
}

type PreviewTab = 'embed' | 'observability' | 'insights';

export function LandingPage({ authLoading, authError, onSignIn }: LandingPageProps) {
  const [previewTab, setPreviewTab] = useState<PreviewTab>('embed');

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <span className="sm:hidden">UAL</span>
            <span className="hidden sm:inline">Unified Agentic Layer (UAL)</span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <a
              href="#capabilities"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#insights"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Customer Insights
            </a>
            <a
              href="#how-it-works"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#isolation"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Cloud Isolation
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              disabled={authLoading}
              onClick={onSignIn}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              {authLoading ? 'Signing in...' : 'Sign in with Google'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-[1200px] mx-auto px-6 pt-14 pb-16 lg:pt-20 lg:pb-20">
          {authError && (
            <div className="mb-6 p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {authError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Left: Value Proposition */}
            <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
              <div className="space-y-5">
                <p className="text-xs font-medium text-slate-500">
                  Self-Serve B2B Chatbot Platform · Built on Google Cloud
                </p>

                <h1 className="text-[clamp(2.25rem,3.8vw,3.4rem)] font-bold tracking-tight text-slate-900 leading-[1.08] text-balance">
                  Turn company data into embeddable chatbots with built-in analytics.
                </h1>

                <p className="text-base text-slate-600 leading-relaxed max-w-[56ch]">
                  Register your company, connect your business website URLs, PostgreSQL databases, public S3 folders, flat files, or live MCP servers, and immediately get a branded customer URL, drop-in embed widget, live REST API, operational observability, and customer question intelligence.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={onSignIn}
                    className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {authLoading ? 'Opening Google Sign-In...' : 'Register Your Company'}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <a
                    href="#capabilities"
                    className="text-sm font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4 decoration-slate-300 hover:decoration-slate-500 transition-colors whitespace-nowrap"
                  >
                    Explore capabilities
                  </a>
                </div>

                <p className="text-xs text-slate-500">
                  Private per-company workspaces · Sign in or register to access your own projects and telemetry
                </p>
              </div>
            </div>

            {/* Right: Interactive Platform Preview Panel */}
            <div className="lg:col-span-6 flex">
              <div className="w-full bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Illustrative Platform Output</p>
                    <p className="text-sm font-semibold text-slate-900">
                      What every project provisions automatically
                    </p>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Platform output preview"
                    className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewTab === 'embed'}
                      onClick={() => setPreviewTab('embed')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        previewTab === 'embed'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Embed URL
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewTab === 'observability'}
                      onClick={() => setPreviewTab('observability')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        previewTab === 'observability'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Observability
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewTab === 'insights'}
                      onClick={() => setPreviewTab('insights')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        previewTab === 'insights'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Customer Insights
                    </button>
                  </div>
                </div>

                {previewTab === 'embed' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">Hosted Customer Chat URL</p>
                        <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-800 truncate">
                          https://your-company.ual.cloud/c/acme-corp/support-bot
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">Drop-in Website Widget</p>
                        <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] whitespace-pre-wrap break-all leading-relaxed">
                          {`<script src="https://chat.acme.io/embed/support-bot.js" async></script>`}
                        </pre>
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">Authenticated REST Endpoint</p>
                        <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-800 truncate">
                          POST /api/v1/bots/support-bot/chat · Authorization: Bearer sk_live_••••
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                      <span>Custom brand colors, starter prompts &amp; widget placement</span>
                      <span className="font-mono text-slate-700">Zero boilerplate</span>
                    </div>
                  </div>
                )}

                {previewTab === 'observability' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div className="grid grid-cols-3 gap-4 pb-4 border-b border-slate-200">
                      <div>
                        <p className="text-xs text-slate-500">Avg Latency</p>
                        <p className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                          640ms
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">P95 Latency</p>
                        <p className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                          1,120ms
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Grounded Rate</p>
                        <p className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
                          94%
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <p className="font-medium text-slate-500">Captured Per-Request Trace</p>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                        <div className="flex items-center justify-between font-mono text-slate-600">
                          <span>HTTP 200 · hosted channel</span>
                          <span className="tabular-nums">580ms · 412 tokens</span>
                        </div>
                        <p className="text-slate-900 font-medium">
                          &ldquo;How do I configure SAML SSO for regional sub-accounts?&rdquo;
                        </p>
                        <p className="text-slate-500 font-mono truncate">
                          Citations: sso_setup_guide.md · MCP: check_plan_entitlements()
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                      <span>Unified across API, Hosted URL &amp; Embed Widget</span>
                      <span className="font-mono text-slate-700">Automatic traces</span>
                    </div>
                  </div>
                )}

                {previewTab === 'insights' && (
                  <div className="space-y-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <p className="text-xs font-medium text-slate-500">
                        Top Questions &amp; Friction Detected
                      </p>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
                        <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-900">Invoice &amp; VAT corrections</span>
                          <span className="font-mono tabular-nums text-slate-600">34% of chats</span>
                        </div>
                        <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-900">Webhook retry timeouts</span>
                          <span className="font-mono tabular-nums text-amber-700">Knowledge gap</span>
                        </div>
                        <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-900">Role permission setup</span>
                          <span className="font-mono tabular-nums text-slate-600">21% of chats</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
                      <p className="font-semibold text-slate-900">
                        Recommended Product Improvement · High Impact
                      </p>
                      <p className="text-slate-600 leading-relaxed">
                        Add self-serve VAT ID editing to the Billing Settings screen and publish webhook retry backoff docs to deflect repetitive support tickets.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full-width 4-Column Platform Capabilities Strip below Hero */}
          <div className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-8">
            <div>
              <p className="text-xs text-slate-500">Data Ingestion</p>
              <p className="text-base font-semibold text-slate-900 mt-1">
                Websites, Postgres, S3 &amp; Files
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Instant Provisioning</p>
              <p className="text-base font-semibold text-slate-900 mt-1">
                Hosted URL, Widget &amp; API
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Live Tool Actions</p>
              <p className="text-base font-semibold text-slate-900 mt-1">
                MCP Server Discovery
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Built-in Intelligence</p>
              <p className="text-base font-semibold text-slate-900 mt-1">
                Traces &amp; Product Insights
              </p>
            </div>
          </div>
        </section>

        {/* Asymmetric Bento Grid: Core Capabilities */}
        <section id="capabilities" className="bg-white border-y border-slate-200 py-16 lg:py-20">
          <div className="max-w-[1200px] mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-medium text-blue-600">Platform Capabilities</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Everything needed to ship and improve production customer assistants.
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* 01: Col-span 7 */}
              <article className="lg:col-span-7 bg-[#F8FAFC] border border-slate-200 rounded-xl p-7 flex flex-col justify-between gap-6">
                <div className="space-y-2.5">
                  <h3 className="text-lg font-semibold text-slate-900">
                    01. Self-Serve Ready-to-Embed URLs &amp; Theme Studio
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed max-w-[60ch]">
                    Each chatbot project immediately generates a dedicated customer chat page, a single-line floating embed script for your website or portal, and a Bearer-authenticated REST endpoint. Customize colors, header branding, welcome copy, and starter prompts with live preview.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">Hosted URL</p>
                    <p className="text-slate-500 font-mono mt-0.5">/c/company/bot</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Widget Script</p>
                    <p className="text-slate-500 font-mono mt-0.5">/embed/bot.js</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">REST Endpoint</p>
                    <p className="text-slate-500 font-mono mt-0.5">/api/v1/bots/chat</p>
                  </div>
                </div>
              </article>

              {/* 02: Col-span 5 */}
              <article className="lg:col-span-5 bg-[#F8FAFC] border border-slate-200 rounded-xl p-7 flex flex-col justify-between gap-6">
                <div className="space-y-2.5">
                  <h3 className="text-lg font-semibold text-slate-900">
                    02. Data Connectors &amp; Live MCP Tools
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Scrape public business websites and docs URLs, connect read-only PostgreSQL databases, crawl public S3 folders, or upload CSV, Markdown, JSON, and PDF files. Attach Streamable HTTP or SSE MCP servers with live tool discovery so assistants answer from both indexed knowledge and live operational systems.
                  </p>
                </div>
                <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 font-mono">
                  Website URLs · PostgreSQL · Public S3 · Flat Files · MCP
                </div>
              </article>

              {/* 03: Col-span 5 */}
              <article className="lg:col-span-5 bg-[#F8FAFC] border border-slate-200 rounded-xl p-7 flex flex-col justify-between gap-6">
                <div className="space-y-2.5">
                  <h3 className="text-lg font-semibold text-slate-900">
                    03. Built-in Service Observability
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Monitor every request across API, hosted chat, embed widget, and playground without wiring external logging agents. Inspect latency distributions, p95 response time, token usage, HTTP error rates, retrieved knowledge citations, and MCP tool execution logs.
                  </p>
                </div>
                <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 font-mono">
                  Avg &amp; P95 Latency · Token Spend · Citations · MCP Calls
                </div>
              </article>

              {/* 04: Col-span 7 */}
              <article className="lg:col-span-7 bg-[#F8FAFC] border border-slate-200 rounded-xl p-7 flex flex-col justify-between gap-6">
                <div className="space-y-2.5">
                  <h3 className="text-lg font-semibold text-slate-900">
                    04. Customer Question Analytics &amp; Product Improvement Insights
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed max-w-[60ch]">
                    Go beyond uptime metrics. Unified Agentic Layer (UAL) automatically groups what customers are asking most, highlights unanswered knowledge gaps and friction points, and synthesizes concrete recommendations on how to improve your product features, documentation, and support workflows.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">Demand Clustering</p>
                    <p className="text-slate-500 mt-0.5">Top recurring customer topics</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Gap Detection</p>
                    <p className="text-slate-500 mt-0.5">Uncited &amp; fallback questions</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Actionable Roadmap</p>
                    <p className="text-slate-500 mt-0.5">Product &amp; doc improvements</p>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Customer Insights Spotlight */}
        <section id="insights" className="max-w-[1200px] mx-auto px-6 py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5 space-y-4">
              <p className="text-xs font-medium text-blue-600">Built-in Product Intelligence</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Know what customers ask — and what to fix in your product next.
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Every customer question is product feedback. Inside your private workspace, UAL analyzes conversation traces to surface recurring blockers, missing documentation, and high-impact improvements before they turn into churn or support queues.
              </p>

              <ul className="space-y-3 pt-2 text-sm text-slate-700">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Automatically tracks grounded self-service resolution vs. knowledge gap rate.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Clusters customer prompts by topic so product teams see top demand drivers.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Generates prioritized recommendations across Product, Documentation, Support Workflow, and Integrations.</span>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Example Customer Insight Loop
                </h3>
                <span className="text-xs text-slate-500">Generated per chatbot service</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">1. Observed Question Signal</p>
                  <p className="text-slate-600 leading-relaxed">
                    Customers repeatedly ask how to export monthly audit logs and why webhook retries fail after 30 seconds.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">2. Gap &amp; Friction Diagnosis</p>
                  <p className="text-slate-600 leading-relaxed">
                    Zero indexed chunks matched audit-log export steps, triggering fallback responses across 18% of technical queries.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">3. Product &amp; Service Action</p>
                  <p className="text-slate-600 leading-relaxed">
                    Add a one-click CSV export button to Billing Settings, document retry headers, and expose a status-check MCP tool.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="bg-white border-y border-slate-200 py-16 lg:py-20">
          <div className="max-w-[1200px] mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs font-medium text-blue-600">Self-Serve Workflow</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                From company registration to live embedded chatbot in minutes.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2.5 pt-4 border-t border-slate-200">
                <p className="text-xs font-mono text-slate-500">Step 01</p>
                <h3 className="text-base font-semibold text-slate-900">
                  Sign in &amp; register your company
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Authenticate with Google to create your isolated company workspace, reserve your customer URL slug, and spin up one or more chatbot projects.
                </p>
              </div>

              <div className="space-y-2.5 pt-4 border-t border-slate-200">
                <p className="text-xs font-mono text-slate-500">Step 02</p>
                <h3 className="text-base font-semibold text-slate-900">
                  Connect data sources &amp; MCPs
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Index PostgreSQL schemas, public S3 folders, or uploaded files into hybrid vector search and attach your MCP servers for real-time operational lookups.
                </p>
              </div>

              <div className="space-y-2.5 pt-4 border-t border-slate-200">
                <p className="text-xs font-mono text-slate-500">Step 03</p>
                <h3 className="text-base font-semibold text-slate-900">
                  Embed your URL &amp; improve continuously
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Customize the widget theme, paste the embed script or share your hosted URL, and review observability traces and product improvement insights as users chat.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Multi-Tenant Isolation & Conversion */}
        <section id="isolation" className="max-w-[1200px] mx-auto px-6 py-16 lg:py-20">
          <div className="bg-white border border-slate-200 rounded-xl p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                <Code2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>Google Cloud Architecture · Strictly Account-Scoped Data</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 text-balance">
                Your companies, knowledge bases, API keys, and traces stay private to your account.
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed max-w-[65ch]">
                No workspace data is shown before sign-in. Each registered account reads and writes strictly within its own Firestore tenant scope, with Cloud Run hosting and a built-in deployment guide for customer wildcard domains (<span className="font-mono text-slate-800">*.yourdomain.com</span>).
              </p>
            </div>

            <div className="lg:col-span-4 flex lg:justify-end">
              <button
                type="button"
                disabled={authLoading}
                onClick={onSignIn}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" aria-hidden="true" />
                {authLoading ? 'Signing in...' : 'Sign in with Google'}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1200px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span className="font-semibold text-slate-900">Unified Agentic Layer (UAL)</span>
          <div className="flex items-center gap-6">
            <a href="#capabilities" className="hover:text-slate-800">Capabilities</a>
            <a href="#insights" className="hover:text-slate-800">Customer Insights</a>
            <a href="#how-it-works" className="hover:text-slate-800">How It Works</a>
            <a href="#isolation" className="hover:text-slate-800">Cloud Isolation</a>
          </div>
          <span>Multi-Tenant Chatbot Platform on Google Cloud</span>
        </div>
      </footer>
    </div>
  );
}
