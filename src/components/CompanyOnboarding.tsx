import React, { useState } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { slugify } from '../utils/ingestion';

interface CompanyOnboardingProps {
  userEmail: string;
  userDisplayName: string;
  onSignOut: () => void;
  onRegisterCompany: (data: {
    companyName: string;
    companySlug: string;
    industry: string;
    firstBotName: string;
  }) => Promise<void>;
  onLoadSampleWorkspace: () => Promise<void>;
}

export function CompanyOnboarding({
  userEmail,
  userDisplayName,
  onSignOut,
  onRegisterCompany,
  onLoadSampleWorkspace,
}: CompanyOnboardingProps) {
  const [companyName, setCompanyName] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [industry, setIndustry] = useState('');
  const [firstBotName, setFirstBotName] = useState('Customer Support Bot');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const derivedSlug = customSlug.trim()
    ? slugify(customSlug)
    : companyName.trim()
      ? slugify(companyName)
      : '';
  const derivedBotSlug = firstBotName.trim() ? slugify(firstBotName) : 'support-bot';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (companyName.trim().length < 2) {
      setError('Company name must be at least 2 characters.');
      return;
    }
    if (firstBotName.trim().length < 2) {
      setError('First chatbot service name must be at least 2 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await onRegisterCompany({
        companyName: companyName.trim(),
        companySlug: slugify(customSlug.trim() || companyName.trim()),
        industry: industry.trim() || 'Technology',
        firstBotName: firstBotName.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSample = async () => {
    setError('');
    setLoadingSample(true);
    try {
      await onLoadSampleWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize sample workspace.');
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6">
        <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
          <span className="sm:hidden">UAL</span>
          <span className="hidden sm:inline">Unified Agentic Layer (UAL)</span>
        </span>
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="hidden sm:inline truncate max-w-[220px]">{userEmail}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-xl space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-blue-600">
              Welcome{userDisplayName ? `, ${userDisplayName.split(' ')[0]}` : ''} · Private Account Setup
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Register your company workspace
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your workspace is empty and isolated to your account. Register your company below to provision your first live chatbot URL, embed script, REST API key, and observability dashboard.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="onboard-company-name" className="block text-xs font-medium text-slate-700">
                  Company Name
                </label>
                <input
                  id="onboard-company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Cloud Systems"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="onboard-company-slug" className="block text-xs font-medium text-slate-700">
                    Company URL Slug
                  </label>
                  <input
                    id="onboard-company-slug"
                    type="text"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    placeholder={derivedSlug || 'acme-cloud'}
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="onboard-industry" className="block text-xs font-medium text-slate-700">
                    Industry
                  </label>
                  <input
                    id="onboard-industry"
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g. SaaS, Logistics, FinTech"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="onboard-first-bot" className="block text-xs font-medium text-slate-700">
                  First Chatbot Service Name
                </label>
                <input
                  id="onboard-first-bot"
                  type="text"
                  value={firstBotName}
                  onChange={(e) => setFirstBotName(e.target.value)}
                  placeholder="e.g. Customer Support Bot"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  required
                />
                <p className="text-xs text-slate-500 font-mono truncate">
                  Hosted URL preview: /c/{derivedSlug || 'your-company'}/{derivedBotSlug}
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting || loadingSample}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Provisioning workspace...' : 'Create Company & Provision Bot'}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </form>

            <div className="mt-5 pt-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-500">
              <span>Want to inspect pre-indexed sample sources and traces first?</span>
              <button
                type="button"
                disabled={submitting || loadingSample}
                onClick={handleSample}
                className="font-medium text-blue-600 hover:text-blue-700 underline underline-offset-4 whitespace-nowrap shrink-0 disabled:opacity-50 text-left sm:text-right"
              >
                {loadingSample ? 'Loading sample...' : 'Load sample workspace'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
