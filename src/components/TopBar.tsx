import { ExternalLink, LogIn, LogOut } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Organization, Project } from '../types';
import type { WorkspaceTab } from './Sidebar';

const TAB_TITLES: Record<WorkspaceTab, string> = {
  overview: 'Overview & API',
  connectors: 'Data & Knowledge',
  mcp: 'MCP Servers',
  theme: 'Theme & Embed',
  storepage: 'Store Page',
  observability: 'Observability & Insights',
  gcp: 'GCP Architecture',
};

interface TopBarProps {
  org: Organization | null;
  project: Project | null;
  activeTab: WorkspaceTab;
  user: User | null;
  authLoading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenHostedChat: () => void;
}

export function TopBar({
  org,
  project,
  activeTab,
  user,
  authLoading,
  onSignIn,
  onSignOut,
  onOpenHostedChat,
}: TopBarProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 shrink-0">
      {/* Left: Contextual Breadcrumb */}
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-500 truncate max-w-[180px]">
          {org?.name ?? 'Workspace'}
        </span>
        {project && (
          <>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="text-slate-700 font-medium truncate max-w-[200px]">
              {project.name}
            </span>
            <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
            <span className="text-slate-900 font-semibold hidden sm:inline whitespace-nowrap">
              {TAB_TITLES[activeTab]}
            </span>
          </>
        )}
      </div>

      {/* Right: Account + Single Primary Action */}
      <div className="flex items-center gap-3 shrink-0">
        {user ? (
          <div className="flex items-center gap-2.5 text-xs text-slate-600">
            <span className="hidden md:inline truncate max-w-[180px]" title={user.email ?? ''}>
              {user.email}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={authLoading}
            onClick={onSignIn}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            {authLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>
        )}

        {project && org && (
          <button
            type="button"
            onClick={onOpenHostedChat}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            Open Hosted Chat
          </button>
        )}
      </div>
    </header>
  );
}
