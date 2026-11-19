import React, { useState } from 'react';
import { X } from 'lucide-react';
import { slugify } from '../utils/ingestion';

interface NewOrgModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; slug: string; industry: string }) => Promise<void>;
}

export function NewOrgModal({ open, onClose, onCreate }: NewOrgModalProps) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const derivedSlug = customSlug.trim() ? slugify(customSlug) : name.trim() ? slugify(name) : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) {
      setError('Company name must be at least 2 characters.');
      return;
    }
    const finalSlug = slugify(customSlug.trim() || name.trim());
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), slug: finalSlug, industry: industry.trim() || 'Technology' });
      setName('');
      setIndustry('');
      setCustomSlug('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register company.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-org-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="new-org-title" className="text-base font-semibold text-slate-900">
            Register Company Workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close register company dialog"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="company-name" className="block text-xs font-medium text-slate-700">
              Company Name
            </label>
            <input
              id="company-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northstar Freight Systems"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="company-slug" className="block text-xs font-medium text-slate-700">
              Customer URL Slug
            </label>
            <input
              id="company-slug"
              type="text"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder={derivedSlug || 'northstar-freight'}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
            <p className="text-xs text-slate-500 font-mono truncate">
              Hosted path: /c/{derivedSlug || 'company-slug'}/{'{bot-slug}'}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="company-industry" className="block text-xs font-medium text-slate-700">
              Industry
            </label>
            <input
              id="company-industry"
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Logistics, FinTech, SaaS"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NewProjectModalProps {
  open: boolean;
  orgSlug: string;
  onClose: () => void;
  onCreate: (data: { name: string; slug: string; description: string; systemPrompt: string }) => Promise<void>;
}

export function NewProjectModal({ open, orgSlug, onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are an enterprise support assistant. Answer using the connected knowledge sources and invoke available MCP tools when live data is requested.'
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const derivedSlug = customSlug.trim() ? slugify(customSlug) : name.trim() ? slugify(name) : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) {
      setError('Chatbot service name must be at least 2 characters.');
      return;
    }
    const finalSlug = slugify(customSlug.trim() || name.trim());
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        slug: finalSlug,
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
      });
      setName('');
      setCustomSlug('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chatbot service.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-proj-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="new-proj-title" className="text-base font-semibold text-slate-900">
            Create Chatbot Service
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close create chatbot dialog"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="bot-name" className="block text-xs font-medium text-slate-700">
              Service Name
            </label>
            <input
              id="bot-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Billing & Claims Assistant"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bot-slug" className="block text-xs font-medium text-slate-700">
              Endpoint Slug
            </label>
            <input
              id="bot-slug"
              type="text"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder={derivedSlug || 'billing-claims-assistant'}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
            <p className="text-xs text-slate-500 font-mono truncate">
              URL: /c/{orgSlug}/{derivedSlug || 'bot-slug'} · API: /api/v1/bots/{derivedSlug || 'bot-slug'}/chat
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bot-desc" className="block text-xs font-medium text-slate-700">
              Description
            </label>
            <input
              id="bot-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of what this assistant handles"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bot-prompt" className="block text-xs font-medium text-slate-700">
              System Instructions
            </label>
            <textarea
              id="bot-prompt"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Provisioning...' : 'Provision Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
