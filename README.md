# UAL — Unified Agentic Layer

**Multi-tenant, MCP-native AI assistant platform for small businesses.** One console connects a business's knowledge
and its live systems, then serves the assistant everywhere the customer already is: on their website (widget), on a
hosted page we generate for them, on a public storefront, or through a REST API — plus live voice.

Built and published on **Google AI Studio**, running on **Google Cloud**.

- Live app: **https://ual-studio.ai.studio**
- Team: **In2Peta**
- Stack: React 19 + Vite + Tailwind 4 + TypeScript (front) · Node 24 + Express 4 + TypeScript (back) · Gemini API +
  Firebase Auth + Cloud Firestore + Secret Manager (Google) · MCP (Model Context Protocol) for tenant integrations

---

## Table of contents

1. [The problem](#the-problem)
2. [What UAL does](#what-ual-does)
3. [Google ecosystem](#google-ecosystem)
4. [Architecture](#architecture)
5. [The seven flows](#the-seven-flows)
6. [Tech stack](#tech-stack)
7. [Project structure](#project-structure)
8. [Getting started](#getting-started)
9. [Deployment](#deployment)
10. [Data model](#data-model)
11. [Endpoints & channels](#endpoints--channels)
12. [Security model](#security-model)
13. [Observability](#observability)
14. [Roadmap](#roadmap)

---

## The problem

Small businesses have customer questions they cannot answer after hours, and no IT team to answer them with. They
typically end up in one of two bad states:

- **No digital presence at all** — no website, no FAQ, no WhatsApp business hours. Every inquiry is lost.
- **A website with static content** — prices change, policies drift, and the owner answers the same ten questions
  daily from memory.

Meanwhile, the tooling that could fix this (chatbots with live data and real actions) assumes an engineering team,
an API contract, and a customer-auth system the business already owns. None of that exists for a 5-person distributor
or a clinic.

## What UAL does

1. **Connect knowledge** — flat files (CSV/JSON/MD/PDF, up to 10 files × 10 MB), a read-only PostgreSQL database, a
   public S3/GCS folder, or a website crawl. Sources are parsed, chunked (1100 chars / 140 overlap), embedded with
   `gemini-embedding-2`, and stored with their vectors.
2. **Connect actions** — plug in the business's own systems over **MCP** (an event platform, a ticketing desk, a stock
   system). Tools are discovered automatically; each tool can be marked as requiring a verified customer.
3. **Serve everywhere** — a drop-in widget script, a hosted chat URL, a block-based public storefront, a REST API, or
   a live voice session. All channels share one bot, one knowledge base, one identity model.
4. **Observe and improve** — every request produces a trace with latency, tokens, citations and the exact tool
   arguments, which the console turns into topic, friction and grounding analytics.

The deliberate design decision: **visitors never hit a login wall.** Questions are answered anonymously; identity is
requested only when a tool needs to know *who* is asking — and even then the customer can sign in with Google, or
bring their own site's session.

---

## Google ecosystem

UAL is deliberately Google-native: the build surface, the hosting, identity, data, and the model layer are all Google
services, and the tenant integrations are cloud-agnostic by design.

| Google service | Role in UAL | Status |
| --- | --- | --- |
| **Google AI Studio** | Build surface and deployment pipeline for the applet (`metadata.json` manifest). Publishes the app behind `ual-studio.ai.studio` | Live |
| **Cloud Run** (managed runtime behind AI Studio) | Hosts the single multi-tenant Node service: REST API, hosted pages, widget loader | Live |
| **Cloud Run** (self-managed) | Portable deployment path for custom domains, using the included `Dockerfile` + Secret Manager binding | Ready in repo |
| **Firebase Authentication** (Google provider) | Owner console sign-in and the hosted customer sign-in popup | Live |
| **Cloud Firestore** (named AI Studio database) | Source of truth: organizations → projects → sources / chunks / mcps / traces. Security rules enforce default-deny, owner-scoped access | Live |
| **Gemini API** (`@google/genai`) | Grounded answers (`gemini-4-hydrogen`, fast fallback `gemini-3.1-flash-lite`), embeddings (`gemini-embedding-2`), PDF text extraction, knowledge-brief synthesis | Live |
| **Gemini Live API** (`gemini-3.8-live`) | Bidirectional live voice over WebSocket, with the same knowledge and tools | Live |
| **Secret Manager** | `ual-gemini-apikey` injected at deploy time; never in the repo, never in the client bundle | Live (deploy-time binding) |
| **Google Identity (OAuth 2.0)** | Backs the Firebase Google sign-in for owners and customers | Live |
| **Certificate Manager + Cloud DNS** | Wildcard TLS for per-tenant custom domains (`*.ual.cloud`) | Roadmap |
| **Cloud Storage / Firebase Storage** | Bucket provisioned; accepted as an S3-style public source URL | Available |

**Non-Google, by choice:** tenant MCP servers and tenant databases live wherever the tenant already runs them (our
EventsHub demo runs on AWS Lambda + API Gateway). UAL speaks MCP, so the customer's stack never has to match ours.

### Gemini models in use

| Capability | Model | Where |
| --- | --- | --- |
| Grounded answer generation | `gemini-4-hydrogen` (primary), `gemini-3.1-flash-lite` (fast fallback) | `server/gemini.ts` |
| Embeddings (ingest + query) | `gemini-embedding-2` | `server/gemini.ts` |
| PDF text extraction | Gemini (document understanding) | `server/gemini.ts` |
| Knowledge brief synthesis | Gemini | `server/gemini.ts` |
| Live voice session | `gemini-3.8-live` | `server/liveVoice.ts` |

---

## Architecture

```
┌──────────────────────────── REQUEST SOURCES ────────────────────────────┐
│ tenant website + widget │ hosted /c/:org/:bot │ store /s/:org/:bot      │
│ REST client (Bearer)    │ owner console SPA  │ sign-in popup  │ voice  │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │  HTTPS / WebSocket
┌──────────────────────────── NETWORK EDGE ───────────────────────────────┐
│ ual-studio.ai.studio · Google Front End · TLS · static SPA bundle       │
│ Express (Node): CORS · JSON 10 MB · X-RelayMesh-Channel · WS upgrade    │
└───────────────────────────────────┬──────────────────────────────────────┘
┌──────────────────────────── API ROUTES (server.ts) ─────────────────────┐
│ /api/public/bots      /api/v1/bots/:o/:b/chat   /api/public/pages       │
│ /api/public/.../identity/google   /api/ingest/*   /api/mcp/discover      │
│ /api/runtime/sync     /api/runtime/traces      /embed/:o/:b.js          │
└───────────────────────────────────┬──────────────────────────────────────┘
┌──────────────────────────── CORE SERVICES ──────────────────────────────┐
│ runtime registry (60 s TTL cache over Firestore)  │ Firestore loader   │
│ grounded chat orchestrator (3-round tool loop)     │ hybrid retrieval   │
│ customer identity (HMAC + injection)               │ MCP client (JSON-RPC)│
│ ingestion pipeline (parse → chunk → embed)         │ traces & analytics │
│ live voice bridge (WS ↔ Gemini Live)              │ widget embed loader │
└───────────────────────────────────┬──────────────────────────────────────┘
┌──────────────────────────── STORAGE & TRUST ────────────────────────────┐
│ Firestore (named DB) + Security Rules │ Firebase Auth │ Secret Manager │
│ server memory: registry, MCP credentials, traces, embedding cache       │
│ browser: sessionStorage identity claim, localStorage chat history      │
└───────────────────────────────────┬──────────────────────────────────────┘
┌──────────────────────────── EXTERNAL SYSTEMS ───────────────────────────┐
│ Gemini API │ tenant MCP servers (e.g. EventsHub on AWS Lambda)           │
│ Google Identity │ tenant Postgres / S3 / websites │ Google Cloud runtime│
└──────────────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Node.js | `node:24-slim` | Process, sockets, event loop, memory, crypto |
| Express 4 | `express` | Routing, middleware chain (CORS → JSON → multer → handler), static SPA + fallback, error handling |
| TypeScript | `tsx` runner | Compile-time contracts shared across front and back; zero runtime cost |
| Business logic | `server/` + `src/utils/` | Retrieval, identity, MCP, ingestion, tracing — hand-written, no agent framework |

---

## The seven flows

| Flow | Path | Entry point |
| --- | --- | --- |
| **Ingestion** | upload → parse → chunk → embed → Firestore → runtime sync | `POST /api/ingest/*` → `server/connectors.ts` |
| **Chat & retrieval** | channel → registry → identity check → hybrid retrieval → Gemini → MCP → trace | `POST /api/v1/bots/:o/:b/chat` → `server/gemini.ts` |
| **Customer identity** | gated tool → sign-in → HMAC voucher → server-side `customerId` injection → resume | `POST /api/public/bots/:o/:b/identity/google` → `server/identity.ts` |
| **Owner auth & rules** | Google sign-in → direct Firestore writes → per-action diff allowlists | `firestore.rules` → `src/lib/firestoreRepo.ts` |
| **Store creation & serving** | block editor → publish toggle → public payload → storefront + chat bubble | `src/components/StorePageTab.tsx` → `GET /api/public/pages/:o/:b` |
| **Serving & channels** | TLS edge → SPA/embed loader → public bot config → channel tagging | `server.ts` (public routes) |
| **Live voice** | mic capture → WS → Gemini Live session → same knowledge + tools | `server/liveVoice.ts` |

### Customer identity in one paragraph

When a tool is marked `requiresCustomerIdentity` and the request carries no verified identity, the server **holds the
call before it leaves our infrastructure** and returns a `loginRequired` signal, so the tenant's system is never
contacted on an unverified request. The visitor signs in (hosted Google popup, or the tenant's own site handing off a
signed claim), the server verifies the HMAC-SHA256 voucher (`{customerId, sig, ts}`, 15-minute expiry) **on every
chat**, and — critically — **overwrites `args.customerId` with the verified ID before the tool call is dispatched**. The
client can never influence who the tool acts as, and the tenant's system receives an identity it can trust.

---

## Tech stack

### Frontend (`src/`)

- **React 19** + **Vite 8** (SPA, `@` path alias) + **Tailwind CSS 4**
- **Recharts** for charts, **lucide-react** icons, **motion** for animation
- **Firebase Web SDK** (Auth + Firestore) — the console writes to Firestore directly; security rules are the
  enforcement point, not the server
- **TypeScript** strict mode; `npm run lint` = `tsc --noEmit`

### Backend (`server/` + `server.ts`)

- **Express 4** on **Node 24**, run directly with `tsx` (no server build step)
- **`ws`** for the live-voice WebSocket upgrade
- **`multer`** for uploads (10 files × 10 MB, extension allowlist)
- **`pg`** for read-only PostgreSQL ingestion, with SSRF/host guards
- **`firebase-admin`** for Firestore (Admin SDK + ADC, named database) and `verifyIdToken`
- **`@google/genai`** for Gemini chat, embeddings, PDF extraction and Live
- **No agent framework** — the tool-calling loop and the MCP client are hand-written so the identity contract is
  enforced at exactly one place in the code

---

## Project structure

```
ual-studio/
├─ server.ts                 # Express app: routes, middleware, static serving
├─ server/
│  ├─ gemini.ts              # Gemini: chat loop, embeddings, PDF, briefs, insights
│  ├─ mcp.ts                 # MCP client: tools/list discovery, tools/call, SSE + HTTP
│  ├─ identity.ts            # HMAC claim sign/verify (15 min TTL)
│  ├─ runtimeStore.ts        # Live registry + trace stream, 60 s TTL cache
│  ├─ firestoreRuntime.ts    # Admin SDK loader (named DB) + verifyIdToken
│  ├─ connectors.ts          # Flat file / Postgres / S3 / website ingestion
│  └─ liveVoice.ts           # WS ↔ Gemini Live bridge
├─ src/
│  ├─ components/            # Console tabs + hosted/widget/store pages
│  ├─ lib/firestoreRepo.ts   # Console Firestore reads/writes (owner-scoped)
│  └─ utils/                 # retrieval, ingestion, analytics, customer history
├─ firestore.rules           # Default-deny, owner-scoped, per-action diff allowlists
├─ firebase-blueprint.json   # Firestore entity + collection schema
├─ firebase-applet-config.json # AI Studio applet config (project, named database id)
├─ metadata.json             # AI Studio applet manifest
└─ Dockerfile                # Cloud Run-ready image
```

---

## Getting started

### Local development

```bash
npm install
cp .env.example .env      # set GEMINI_API_KEY for AI features
npm run dev               # http://localhost:3000
```

- `npm run dev` → `tsx server.ts` (API + Vite middleware, one origin, no proxy)
- `npm run build` → Vite production build into `dist/`
- `npm run lint` → TypeScript check (`tsc --noEmit`)

**Local developer mode.** Without Application Default Credentials the server runs a self-contained demo tenant
(Meridian Logistics) in memory, so the UI can be developed without cloud access. In production the registry is a
cache over Cloud Firestore via the Admin SDK, with the named AI Studio database resolved from
`firebase-applet-config.json`.

To point local development at a real project, provide ADC (`gcloud auth application-default login`) so the loader can
read the named Firestore database.

### AI Studio publish

The applet is built and published from **Google AI Studio**: push to the repo, then publish in the AI Studio UI.
Two AI-Studio-provided values are injected at runtime:

| Variable | Source |
| --- | --- |
| `GEMINI_API_KEY` | Secrets panel (Secret Manager secret `ual-gemini-apikey`) |
| `APP_URL` | Cloud Run service URL, for self-referential links and callbacks |

### Cloud Run (self-managed path)

```bash
gcloud run deploy ual-platform \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=ual-gemini-apikey:latest"
```

The image is `node:24-slim`, runs `npx tsx server.ts`, honors `PORT`, and needs the service account to have
`datastore.viewer` on the named database.

---

## Data model

Firestore database: `ai-studio-remixualunifieda-f4183cb5-7dcd-4f84-a173-85bd31f6d715` (the named AI Studio database).

```
organizations/{orgId}
├─ projects/{projectId}                     # name, slug, systemPrompt, knowledgeBrief,
│  │                                          # apiKey, theme, hostedSignIn, identitySecret,
│  │                                          # loginUrl, storePage, chunkCount, sourceCount
│  ├─ sources/{sourceId}                    # flatfile | postgres | s3_public | website
│  ├─ chunks/{chunkId}                      # content, tokenEstimate, embedding (≤1024 dims)
│  ├─ mcps/{mcpId}                          # endpointUrl, transport, authHeaderName,
│  │                                          # authTokenMasked, tools[]
│  └─ traces/{traceId}                      # query, responsePreview, latencyMs, tokens,
│                                             # statusCode, channel, citations[], mcpCalls[]
```

> Publish `firestore.rules` to the named database (`ai-studio-remixualunifieda-…`), not `(default)`, so console
> writes are authorized.

---

## Endpoints & channels

Customer-facing surface:

| Endpoint | Access model |
| --- | --- |
| `GET /api/public/bots/:orgSlug/:botSlug` | Public — theme and counts only, no secrets |
| `POST /api/v1/bots/:orgSlug/:botSlug/chat` | Project Bearer key for the `api` channel; open for `widget` / `hosted` / `playground` so the assistant is embeddable with zero tenant setup |
| `POST /api/public/bots/:orgSlug/:botSlug/identity/google` | Google ID token → signed voucher |
| `GET /api/public/pages/:orgSlug/:botSlug` | Public — published storefronts only |
| `GET /embed/:orgSlug/:botSlug.js` | Public widget loader |
| `WS /api/v1/bots/:orgSlug/:botSlug/live` | Live voice session |

Console-internal endpoints (`/api/ingest/*`, `/api/mcp/discover`, `/api/runtime/sync`, `/api/runtime/bots`,
`/api/runtime/traces/:o/:b`) are invoked by the signed-in owner console.

Channel is carried in the `X-RelayMesh-Channel` header (`widget`, `hosted`, `playground`, `api`) and recorded on every
trace, so the console can show which surface drives demand.

---

## Security model

### Enforced today

- **Tenant data isolation** — Firestore rules are default-deny and owner-scoped; every runtime key is a compound
  `org/bot` id rather than a display name, so two tenants can never collide on a bot name.
- **Secrets never reach the client** — the public bot payload contains theme and counts only; `apiKey`,
  `identitySecret` and MCP credentials stay server-side. MCP credentials are masked at rest and held in server memory
  for the lifetime of the connection, never persisted to the database and never sent to the browser.
- **Customer identity cannot be forged or spoofed** — HMAC-SHA256 voucher, 15-minute expiry, verified server-side on
  every request, and the customer ID is injected by the server, never taken from the client.
- **Per-request authorization on tool calls** — gated tools are held before dispatch when identity is unverified, and
  the tenant's MCP server receives a verified, server-assigned customer ID.
- **No training on customer data** — only inference, embeddings and document extraction.

### Next hardening milestone

- Signed embed tokens and a per-tenant **origin allowlist**, so a tenant's widget can be pinned to its own domain
- Per-tenant **rate limits and usage quotas** on the chat path
- Owner-scoped trace access with retention windows and PII masking on stored query text
- Per-tenant encrypted storage for MCP credentials, replacing the in-memory connection model

---

## Observability

Every request produces a trace: latency, prompt/completion tokens, status code, channel, citations and the exact MCP
call arguments and timings. Traces stream into the console in real time, where they are aggregated into topic mix,
grounded-resolution rate, MCP-assisted rate, friction signals (HTTP errors, ungrounded answers, fallback replies) and
product recommendations ([src/utils/analytics.ts](src/utils/analytics.ts)). The console can also ask Gemini for
narrative insights over the most recent traffic.

Next in this line: durable per-tenant trace history, daily aggregates with cost tracking, and configurable retention.

---

## Roadmap

- Signed embed tokens, per-tenant origin allowlist, rate limits and quotas
- Durable trace history with per-tenant daily aggregates and cost tracking
- Per-tenant encrypted storage for MCP credentials
- Custom domains and white-label storefronts (`*.ual.cloud` via Certificate Manager)
- Per-tenant connector health checks and re-index scheduling
- Retrieval scale-up: Firestore native vector search beyond brute-force cosine
- Automated answer-quality evaluation suite per tenant

---

## License

Prototype for the Google Startup Buildathon 2026 — In2Peta.
