import {
  Activity,
  Cloud,
  Database,
  LayoutGrid,
  Palette,
  Plug,
  Plus,
  Building2,
} from 'lucide-react';
import type { Organization, Project } from '../types';

export type WorkspaceTab =
  | 'overview'
  | 'connectors'
  | 'mcp'
  | 'theme'
  | 'observability'
  | 'gcp';

interface SidebarProps {
  organizations: Organization[];
  activeOrg: Organization | null;
  projects: Project[];
  activeProject: Project | null;
  activeTab: WorkspaceTab;
  onSelectOrg: (orgId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenNewOrg: () => void;
  onOpenNewProject: () => void;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutGrid }> = [
  { id: 'overview', label: 'Overview & API', icon: LayoutGrid },
  { id: 'connectors', label: 'Data & Knowledge', icon: Database },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'theme', label: 'Theme & Embed', icon: Palette },
  { id: 'observability', label: 'Observability & Insights', icon: Activity },
  { id: 'gcp', label: 'GCP Architecture', icon: Cloud },
];

export function Sidebar({
  organizations,
  activeOrg,
  projects,
  activeProject,
  activeTab,
  onSelectOrg,
  onSelectProject,
  onSelectTab,
  onOpenNewOrg,
  onOpenNewProject,
}: SidebarProps) {
  return (
    <aside className="w-full lg:w-[260px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col">
      {/* Brand Wordmark */}
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
        <a
          href="/"
          className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Unified Agentic Layer (UAL)
        </a>
      </div>

      <div className="p-4 space-y-6 flex-1 overflow-y-auto">
        {/* Organization Switcher */}
        <section className="space-y-2" aria-label="Company selector">
          <div className="flex items-center justify-between">
            <label htmlFor="org-switcher" className="text-xs font-medium text-slate-500">
              Company
            </label>
            <button
              type="button"
              onClick={onOpenNewOrg}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Register
            </button>
          </div>
          <div className="relative">
            <Building2
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <select
              id="org-switcher"
              value={activeOrg?.id ?? ''}
              onChange={(e) => onSelectOrg(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
          {activeOrg && (
            <p className="text-xs text-slate-500 truncate">
              {activeOrg.industry || 'Enterprise Workspace'} · /{activeOrg.slug}
            </p>
          )}
        </section>

        {/* Chatbot Projects List */}
        <section className="space-y-2 border-t border-slate-200 pt-5" aria-label="Chatbot services">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Chatbot Services</span>
            <button
              type="button"
              onClick={onOpenNewProject}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              New Bot
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="py-3 text-xs text-slate-500">
              No chatbot services yet. Create one to provision an endpoint.
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map((proj) => {
                const isSelected = proj.id === activeProject?.id;
                return (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => onSelectProject(proj.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-sm font-medium truncate">{proj.name}</span>
                    <span
                      className={`text-[11px] font-mono shrink-0 ${
                        isSelected ? 'text-slate-300' : 'text-slate-400'
                      }`}
                    >
                      {proj.status === 'active' ? 'Live' : 'Paused'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Project Navigation */}
        {activeProject && (
          <nav className="space-y-1 border-t border-slate-200 pt-5" aria-label="Service sections">
            <span className="block px-3 pb-1 text-xs font-medium text-slate-500">
              Service Console
            </span>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
