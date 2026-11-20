import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import type { Organization, Project, StorePage, StorePageItem, StorePageSection, StoreSectionType } from '../types';
import { StorePageRenderer } from './StorePageRenderer';

interface StorePageTabProps {
  org: Organization;
  project: Project;
  onSavePage: (page: StorePage) => Promise<void>;
}

const SECTION_LABELS: Record<StoreSectionType, string> = {
  hero: 'Hero Banner',
  about: 'About',
  services: 'Services / Menu',
  gallery: 'Gallery',
  hours: 'Opening Hours',
  contact: 'Contact',
};

const ITEM_SECTIONS: StoreSectionType[] = ['services', 'gallery', 'hours', 'contact'];

function makeSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyItem(): StorePageItem {
  return { title: '', subtitle: '', price: '', imageUrl: '' };
}

function makeSection(type: StoreSectionType): StorePageSection {
  const base: StorePageSection = {
    id: makeSectionId(),
    type,
    enabled: true,
    heading: SECTION_LABELS[type],
    body: '',
    imageUrl: '',
    items: [],
  };
  if (type === 'hero') {
    base.heading = 'Welcome to our store';
    base.body = 'Tell visitors what makes you special.';
  }
  if (type === 'services') base.items = [emptyItem()];
  if (type === 'hours') {
    base.heading = 'Opening Hours';
    base.items = [{ title: 'Mon – Fri', subtitle: '9:00 AM – 6:00 PM', price: '', imageUrl: '' }];
  }
  if (type === 'contact') {
    base.items = [{ title: 'Phone', subtitle: '', price: '', imageUrl: '' }];
  }
  return base;
}

function makeDefaultPage(org: Organization, project: Project): StorePage {
  return {
    published: false,
    title: project.name || org.name,
    tagline: project.description || '',
    logoUrl: '',
    primaryColor: project.theme.primaryColor || '#2563eb',
    sections: [makeSection('hero'), makeSection('about'), makeSection('services'), makeSection('hours'), makeSection('contact')],
  };
}

export function StorePageTab({ org, project, onSavePage }: StorePageTabProps) {
  const [draft, setDraft] = useState<StorePage>(() => project.storePage ?? makeDefaultPage(org, project));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(draft));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [addType, setAddType] = useState<StoreSectionType>('services');
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    const next = project.storePage ?? makeDefaultPage(org, project);
    setDraft(next);
    setSavedJson(JSON.stringify(next));
    setNotice('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const dirty = JSON.stringify(draft) !== savedJson;

  const publicUrl = `${window.location.origin}/s/${org.slug}/${project.slug}`;

  const patch = (partial: Partial<StorePage>) => setDraft((prev) => ({ ...prev, ...partial }));

  const patchSection = (id: string, partial: Partial<StorePageSection>) =>
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    }));

  const patchItem = (sectionId: string, idx: number, partial: Partial<StorePageItem>) =>
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.map((it, i) => (i === idx ? { ...it, ...partial } : it)) }
          : s
      ),
    }));

  const moveSection = (idx: number, dir: -1 | 1) =>
    setDraft((prev) => {
      const next = [...prev.sections];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, sections: next };
    });

  const handleSave = async () => {
    setSaving(true);
    setNotice('');
    try {
      await onSavePage(draft);
      setSavedJson(JSON.stringify(draft));
      setNotice(draft.published ? 'Saved. Your store page is live.' : 'Saved as draft. Toggle Publish to make it live.');
    } catch {
      setNotice('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore
    }
  };

  const inputCls =
    'w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600';
  const labelCls = 'block text-[11px] font-medium text-slate-500 mb-1';

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Store Page Studio</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              A hosted storefront for businesses without a website — your chatbot is embedded automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <Eye className="w-3.5 h-3.5" />
              {previewOpen ? 'Hide preview' : 'Show preview'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-slate-200 pt-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => patch({ published: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
            />
            Published (publicly accessible)
          </label>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs font-mono text-slate-600 truncate">{publicUrl}</span>
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {project.storePage?.published && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open
              </a>
            )}
          </div>
        </div>
        {notice && <p className="text-xs text-slate-600">{notice}</p>}
        {dirty && !notice && <p className="text-xs text-amber-600">Unsaved changes — preview shows your draft.</p>}
      </section>

      <div className={`grid grid-cols-1 gap-4 ${previewOpen ? 'xl:grid-cols-2' : ''}`}>
        {/* Editor */}
        <div className="space-y-4">
          {/* Page settings */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Page Settings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Store title</label>
                <input className={inputCls} value={draft.title} maxLength={100} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Tagline</label>
                <input className={inputCls} value={draft.tagline} maxLength={200} onChange={(e) => patch({ tagline: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Logo image URL</label>
                <input className={inputCls} value={draft.logoUrl} maxLength={500} placeholder="https://…" onChange={(e) => patch({ logoUrl: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Brand color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.primaryColor}
                    onChange={(e) => patch({ primaryColor: e.target.value })}
                    className="w-9 h-8 rounded border border-slate-200 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-600">{draft.primaryColor}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Sections */}
          {draft.sections.map((section, idx) => (
            <section key={section.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900">{SECTION_LABELS[section.type]}</span>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={(e) => patchSection(section.id, { enabled: e.target.checked })}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                    />
                    Visible
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveSection(idx, -1)} disabled={idx === 0} aria-label="Move up" className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveSection(idx, 1)} disabled={idx === draft.sections.length - 1} aria-label="Move down" className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ sections: draft.sections.filter((s) => s.id !== section.id) })}
                    aria-label="Delete section"
                    className="p-1.5 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Heading</label>
                  <input className={inputCls} value={section.heading} maxLength={120} onChange={(e) => patchSection(section.id, { heading: e.target.value })} />
                </div>
                {(section.type === 'hero' || section.type === 'about') && (
                  <div>
                    <label className={labelCls}>Image URL</label>
                    <input className={inputCls} value={section.imageUrl} maxLength={500} placeholder="https://…" onChange={(e) => patchSection(section.id, { imageUrl: e.target.value })} />
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Body text</label>
                <textarea
                  className={`${inputCls} min-h-[64px]`}
                  value={section.body}
                  maxLength={2000}
                  onChange={(e) => patchSection(section.id, { body: e.target.value })}
                />
              </div>

              {ITEM_SECTIONS.includes(section.type) && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500">
                      {section.type === 'hours' ? 'Days & hours' : section.type === 'contact' ? 'Contact entries' : 'Items'}
                    </span>
                    <button
                      type="button"
                      onClick={() => patchSection(section.id, { items: [...section.items, emptyItem()].slice(0, 12) })}
                      disabled={section.items.length >= 12}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                  {section.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start bg-slate-50 rounded-lg p-2.5">
                      <input
                        className={inputCls}
                        value={item.title}
                        maxLength={120}
                        placeholder={section.type === 'hours' ? 'Mon – Fri' : section.type === 'contact' ? 'Phone' : 'Item name'}
                        onChange={(e) => patchItem(section.id, itemIdx, { title: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        value={item.subtitle}
                        maxLength={200}
                        placeholder={section.type === 'hours' ? '9:00 AM – 6:00 PM' : section.type === 'contact' ? '+1 555 010 2030' : 'Short description'}
                        onChange={(e) => patchItem(section.id, itemIdx, { subtitle: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => patchSection(section.id, { items: section.items.filter((_, i) => i !== itemIdx) })}
                        aria-label="Remove item"
                        className="p-1.5 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      {(section.type === 'services' || section.type === 'gallery') && (
                        <>
                          <input
                            className={inputCls}
                            value={item.imageUrl}
                            maxLength={500}
                            placeholder="Image URL (https://…)"
                            onChange={(e) => patchItem(section.id, itemIdx, { imageUrl: e.target.value })}
                          />
                          <input
                            className={inputCls}
                            value={item.price}
                            maxLength={40}
                            placeholder={section.type === 'services' ? '$25' : ''}
                            onChange={(e) => patchItem(section.id, itemIdx, { price: e.target.value })}
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

          {/* Add section */}
          <section className="bg-white border border-dashed border-slate-300 rounded-xl p-4 flex items-center gap-3">
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value as StoreSectionType)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
            >
              {(Object.keys(SECTION_LABELS) as StoreSectionType[]).map((t) => (
                <option key={t} value={t}>{SECTION_LABELS[t]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => patch({ sections: [...draft.sections, makeSection(addType)] })}
              disabled={draft.sections.length >= 10}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              Add section
            </button>
            <span className="text-[11px] text-slate-400">{draft.sections.length}/10 sections</span>
          </section>
        </div>

        {/* Live preview */}
        {previewOpen && (
          <div className="xl:sticky xl:top-4 self-start w-full">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Live Preview</span>
                <span className="text-[11px] text-slate-400">Chat bubble appears on the published page</span>
              </div>
              <div className="h-[640px] overflow-y-auto bg-white">
                <StorePageRenderer page={draft} orgName={org.name} chatEnabled={false} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}