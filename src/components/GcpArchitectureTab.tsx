import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Organization, Project } from '../types';

interface GcpArchitectureTabProps {
  org: Organization;
  project: Project;
}

export function GcpArchitectureTab({ org, project }: GcpArchitectureTabProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customDomain, setCustomDomain] = useState('ual.cloud');

  const copyBlock = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore
    }
  };

  const deployCmd = `# 1. Deploy single multi-tenant Cloud Run service (serves portal, API, hosted URLs, widgets)
gcloud run deploy ual-platform \\
  --source . \\
  --region us-central1 \\
  --allow-unauthenticated \\
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest"

# 2. Provision wildcard TLS cert via GCP Certificate Manager (for *.${customDomain})
gcloud certificate-manager dns-authorizations create ual-dns-auth \\
  --domain="${customDomain}"

gcloud certificate-manager certificates create ual-wildcard-cert \\
  --domains="*.${customDomain},${customDomain}" \\
  --dns-authorizations="ual-dns-auth"`;

  const hostRoutingSnippet = `// Express Host-Header Tenant Router (for Wildcard Subdomains on Cloud Run)
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  const baseDomain = '${customDomain}';
  if (host.endsWith('.' + baseDomain)) {
    const companySlug = host.slice(0, -(baseDomain.length + 1));
    // e.g. https://${org.slug}.${customDomain}/${project.slug}
    req.headers['x-tenant-org-slug'] = companySlug;
  }
  next();
});`;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Google Cloud Deployment & Customer URL Architecture
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Single multi-tenant Cloud Run deployment serving all customer chatbots with zero per-tenant container sprawl.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="gcp-domain-input" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Base Domain
            </label>
            <input
              id="gcp-domain-input"
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.trim() || 'ual.cloud')}
              className="px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg w-44"
            />
          </div>
        </div>

        {/* Service Matrix */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/60">
                <th className="py-2.5 px-4">GCP Service</th>
                <th className="py-2.5 px-4">Responsibility</th>
                <th className="py-2.5 px-4">Active Multi-Tenant Pattern</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">Cloud Run</td>
                <td className="py-3 px-4">B2B Portal, Ingestion Workers, MCP Client, Live Chat Endpoints</td>
                <td className="py-3 px-4 font-mono">1 container · scales to zero · automatic HTTPS</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">Cloud Firestore / Cloud SQL</td>
                <td className="py-3 px-4">Tenants, Projects, Knowledge Chunks & Embeddings, Trace Logs</td>
                <td className="py-3 px-4 font-mono">Scoped by /organizations/{org.slug}/projects/{project.slug}</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">Firebase Authentication</td>
                <td className="py-3 px-4">Company Workspace Sign-In & Zero-Trust Rules Enforcement</td>
                <td className="py-3 px-4 font-mono">Google OAuth + verified ownerId isolation</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">Gemini API (Vertex AI)</td>
                <td className="py-3 px-4">gemini-embedding-2 vectors + gemini-4-hydrogen RAG & MCP calling</td>
                <td className="py-3 px-4 font-mono">Server-side proxy with Secret Manager API key</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">Cloud DNS + External ALB</td>
                <td className="py-3 px-4">Optional Wildcard Subdomains (*.{customDomain}) + Wildcard TLS</td>
                <td className="py-3 px-4 font-mono">A record *.{customDomain} → ALB → Cloud Run NEG</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Customer URL Routing Comparison */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          Customer URL Topologies for {org.name}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          <div className="space-y-1.5 pt-2 md:pt-0">
            <p className="text-xs font-semibold text-blue-700">01. Path-Based (Live Now)</p>
            <p className="text-xs font-mono text-slate-800 break-all">
              /c/{org.slug}/{project.slug}
            </p>
            <p className="text-xs text-slate-500">
              Zero DNS or Load Balancer config required. Provisions instantaneously on Cloud Run.
            </p>
          </div>
          <div className="space-y-1.5 pt-4 md:pt-0 md:pl-6">
            <p className="text-xs font-semibold text-slate-900">02. Wildcard Subdomain</p>
            <p className="text-xs font-mono text-slate-800 break-all">
              https://{org.slug}.{customDomain}/{project.slug}
            </p>
            <p className="text-xs text-slate-500">
              Requires Cloud DNS wildcard record + GCP External App Load Balancer + Certificate Manager wildcard cert.
            </p>
          </div>
          <div className="space-y-1.5 pt-4 md:pt-0 md:pl-6">
            <p className="text-xs font-semibold text-slate-900">03. Customer Custom Domain</p>
            <p className="text-xs font-mono text-slate-800 break-all">
              https://chat.{org.slug}.com
            </p>
            <p className="text-xs text-slate-500">
              Customer adds a CNAME to proxy.{customDomain}; TLS cert issued automatically via Certificate Manager API.
            </p>
          </div>
        </div>
      </section>

      {/* Copyable Deployment Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Cloud Run & Wildcard Cert CLI</h2>
            <button
              type="button"
              onClick={() => copyBlock('gcloud', deployCmd)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              {copiedId === 'gcloud' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedId === 'gcloud' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed">
            <code>{deployCmd}</code>
          </pre>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Host-Header Tenant Middleware</h2>
            <button
              type="button"
              onClick={() => copyBlock('host', hostRoutingSnippet)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              {copiedId === 'host' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedId === 'host' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed">
            <code>{hostRoutingSnippet}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
