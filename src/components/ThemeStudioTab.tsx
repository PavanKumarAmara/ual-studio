import React, { useEffect, useState } from 'react';
import { AudioLines, Check, Copy, ExternalLink, History, Mic, Plus, Send, SquarePen, X } from 'lucide-react';
import type { ChatTheme, ChatTurnMessage, LiveVoiceName, Organization, Project, TraceLog } from '../types';
import { LIVE_VOICE_OPTIONS, normalizeVoiceName } from '../utils/voiceAudio';

interface ThemeStudioTabProps {
  org: Organization;
  project: Project;
  onSaveTheme: (theme: ChatTheme) => Promise<void>;
  onRecordTrace: (trace: TraceLog) => void;
  onOpenHostedChat: () => void;
}

const PRESET_COLORS = ['#2563EB', '#0F172A', '#059669', '#7C3AED', '#DC2626', '#0284C7'];

export function ThemeStudioTab({
  org,
  project,
  onSaveTheme,
  onRecordTrace,
  onOpenHostedChat,
}: ThemeStudioTabProps) {
  const [theme, setTheme] = useState<ChatTheme>(project.theme);
  const [newStarter, setNewStarter] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Live preview chat state
  const [previewMsgs, setPreviewMsgs] = useState<ChatTurnMessage[]>([]);
  const [previewInput, setPreviewInput] = useState('');
  const [previewSending, setPreviewSending] = useState(false);

  useEffect(() => {
    setTheme(project.theme);
    setPreviewMsgs([]);
  }, [project.id, project.theme]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-service.run.app';
  const historyEnabled = theme.enableCustomerHistory !== false;
  const retentionDays = theme.historyRetentionDays ?? 30;
  const voiceEnabled = Boolean(theme.enableVoiceMode);
  const voiceName = normalizeVoiceName(theme.voiceName);
  const embedComments = [
    '<!-- Unified Agentic Layer (UAL) Embeddable Widget -->',
    ...(historyEnabled
      ? ['<!-- Optional: pass data-customer-id="USER_ID" to scope history per signed-in customer -->']
      : []),
    ...(voiceEnabled
      ? ['<!-- Live Voice Mode is enabled: embed iframe automatically requests microphone access -->']
      : []),
  ].join('\n');
  const embedCode = `${embedComments}\n<script src="${origin}/embed/${project.slug}.js" async></script>`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveTheme(theme);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addStarterPrompt = () => {
    const clean = newStarter.trim();
    if (!clean || theme.starterPrompts.length >= 6) return;
    setTheme((prev) => ({
      ...prev,
      starterPrompts: [...prev.starterPrompts, clean.slice(0, 140)],
    }));
    setNewStarter('');
  };

  const removeStarterPrompt = (idx: number) => {
    setTheme((prev) => ({
      ...prev,
      starterPrompts: prev.starterPrompts.filter((_, i) => i !== idx),
    }));
  };

  const sendPreviewMessage = async (text: string) => {
    const clean = text.trim();
    if (!clean || previewSending) return;
    const nextHistory = [...previewMsgs, { role: 'user' as const, content: clean }];
    setPreviewMsgs(nextHistory);
    setPreviewInput('');
    setPreviewSending(true);
    try {
      const res = await fetch(`/api/v1/bots/${project.slug}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RelayMesh-Channel': 'widget',
        },
        body: JSON.stringify({
          message: clean,
          history: previewMsgs.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview request failed.');
      setPreviewMsgs([
        ...nextHistory,
        {
          role: 'assistant',
          content: data.reply,
          citations: data.citations ?? [],
          mcpCalls: data.mcpCalls ?? [],
        },
      ]);
      if (data.trace) onRecordTrace(data.trace);
    } catch (err) {
      setPreviewMsgs([
        ...nextHistory,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Unable to reach chat endpoint.',
        },
      ]);
    } finally {
      setPreviewSending(false);
    }
  };

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1800);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left 7 Columns: Theme Controls & Embed Script */}
      <form onSubmit={handleSave} className="xl:col-span-7 space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-slate-900">Chat Theme Studio</h1>
              <p className="text-xs text-slate-500">
                Customizes both your hosted URL (/c/{org.slug}/{project.slug}) and embedded widget.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenHostedChat}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Full Page
            </button>
          </div>

          {/* Accent Color */}
          <div className="space-y-2">
            <label htmlFor="theme-primary-color" className="block text-xs font-medium text-slate-700">
              Brand Accent Color
            </label>
            <div className="flex flex-wrap items-center gap-2.5">
              {PRESET_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setTheme((prev) => ({ ...prev, primaryColor: hex }))}
                  aria-label={`Select color ${hex}`}
                  className={`w-7 h-7 rounded-lg border transition-transform ${
                    theme.primaryColor.toLowerCase() === hex.toLowerCase()
                      ? 'ring-2 ring-offset-2 ring-slate-900 scale-105'
                      : 'border-slate-200'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <input
                id="theme-primary-color"
                type="color"
                value={theme.primaryColor}
                onChange={(e) => setTheme((prev) => ({ ...prev, primaryColor: e.target.value }))}
                className="w-9 h-8 p-0.5 border border-slate-200 rounded-lg bg-white cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-600">{theme.primaryColor}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="theme-header-title" className="block text-xs font-medium text-slate-700">
                Header Title
              </label>
              <input
                id="theme-header-title"
                type="text"
                value={theme.headerTitle}
                onChange={(e) => setTheme((prev) => ({ ...prev, headerTitle: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="theme-subtitle" className="block text-xs font-medium text-slate-700">
                Header Subtitle
              </label>
              <input
                id="theme-subtitle"
                type="text"
                value={theme.subtitle}
                onChange={(e) => setTheme((prev) => ({ ...prev, subtitle: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="theme-welcome" className="block text-xs font-medium text-slate-700">
              Welcome Message
            </label>
            <textarea
              id="theme-welcome"
              rows={2}
              value={theme.welcomeMessage}
              onChange={(e) => setTheme((prev) => ({ ...prev, welcomeMessage: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="theme-position" className="block text-xs font-medium text-slate-700">
                Widget Launcher Corner
              </label>
              <select
                id="theme-position"
                value={theme.position}
                onChange={(e) =>
                  setTheme((prev) => ({
                    ...prev,
                    position: e.target.value as 'bottom-right' | 'bottom-left',
                  }))
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="theme-radius" className="block text-xs font-medium text-slate-700">
                Corner Radius ({theme.borderRadius}px)
              </label>
              <input
                id="theme-radius"
                type="range"
                min={0}
                max={24}
                value={theme.borderRadius}
                onChange={(e) =>
                  setTheme((prev) => ({ ...prev, borderRadius: Number(e.target.value) }))
                }
                className="w-full accent-blue-600 mt-2"
              />
            </div>
          </div>

          {/* Starter Prompts */}
          <div className="space-y-2 border-t border-slate-200 pt-4">
            <label htmlFor="new-starter-prompt" className="block text-xs font-medium text-slate-700">
              Suggested Starter Prompts ({theme.starterPrompts.length}/6)
            </label>
            <div className="flex gap-2">
              <input
                id="new-starter-prompt"
                type="text"
                value={newStarter}
                onChange={(e) => setNewStarter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addStarterPrompt();
                  }
                }}
                placeholder="Add a suggested question..."
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
              <button
                type="button"
                onClick={addStarterPrompt}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="space-y-1.5">
              {theme.starterPrompts.map((p, idx) => (
                <div
                  key={`${p}-${idx}`}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700"
                >
                  <span className="truncate">{p}</span>
                  <button
                    type="button"
                    onClick={() => removeStarterPrompt(idx)}
                    aria-label={`Remove prompt ${p}`}
                    className="text-slate-400 hover:text-red-600 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Owner-Controlled Customer Conversation History */}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                  <span id="history-toggle-label" className="text-xs font-semibold text-slate-900">
                    Customer Conversation History
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  When enabled, returning customers can view past threads, resume earlier chats, start new conversations, or clear their history on your hosted URL and embedded widget.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={historyEnabled}
                aria-labelledby="history-toggle-label"
                onClick={() =>
                  setTheme((prev) => ({
                    ...prev,
                    enableCustomerHistory: !(prev.enableCustomerHistory !== false),
                  }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                  historyEnabled ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    historyEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {historyEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <div className="space-y-1">
                  <label htmlFor="theme-history-retention" className="block text-xs font-medium text-slate-700">
                    History Retention Window
                  </label>
                  <select
                    id="theme-history-retention"
                    value={retentionDays}
                    onChange={(e) =>
                      setTheme((prev) => ({
                        ...prev,
                        historyRetentionDays: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days (Recommended)</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-700">Per-Customer Scoping</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Scoped automatically per visitor browser, or pass{' '}
                    <code className="font-mono text-slate-700">data-customer-id</code> on the embed script for logged-in users.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Per-Shop Live Voice Mode (Gemini Live) */}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <AudioLines className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                  <span id="voice-toggle-label" className="text-xs font-semibold text-slate-900">
                    Live Voice Mode (Real-Time Audio)
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Let customers talk live with this shop&apos;s assistant using natural voice interruption, knowledge grounding, and MCP tool calls. Controlled independently per chatbot service.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={voiceEnabled}
                aria-labelledby="voice-toggle-label"
                onClick={() =>
                  setTheme((prev) => ({
                    ...prev,
                    enableVoiceMode: !Boolean(prev.enableVoiceMode),
                    voiceName: normalizeVoiceName(prev.voiceName),
                  }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                  voiceEnabled ? 'bg-blue-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                    voiceEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {voiceEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <div className="space-y-1">
                  <label htmlFor="theme-voice-name" className="block text-xs font-medium text-slate-700">
                    Assistant Voice Persona
                  </label>
                  <select
                    id="theme-voice-name"
                    value={voiceName}
                    onChange={(e) =>
                      setTheme((prev) => ({
                        ...prev,
                        voiceName: normalizeVoiceName(e.target.value as LiveVoiceName),
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {LIVE_VOICE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} — {opt.tone}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-700">Transcript &amp; Widget Sync</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Spoken turns transcribe directly into chat history, and embedded iframes automatically enable microphone access.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-emerald-700">
              {savedNotice ? 'Theme, history & voice settings published to hosted URL & widget.' : ''}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Publishing Theme...' : 'Publish Theme'}
            </button>
          </div>
        </section>

        {/* Embed Script Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Embed on Any Website</h2>
              <p className="text-xs text-slate-500">
                Paste before &lt;/body&gt; to inject the floating launcher and themed iframe widget.
              </p>
            </div>
            <button
              type="button"
              onClick={copyEmbed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              {copiedEmbed ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedEmbed ? 'Copied' : 'Copy Script'}
            </button>
          </div>
          <pre className="bg-slate-900 text-slate-100 text-xs font-mono p-4 rounded-lg overflow-x-auto">
            <code>{embedCode}</code>
          </pre>
        </section>
      </form>

      {/* Right 5 Columns: Live Interactive Branded Preview */}
      <div className="xl:col-span-5 flex flex-col items-center">
        <div
          className="w-full max-w-[420px] border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]"
          style={{
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
            borderRadius: `${theme.borderRadius}px`,
          }}
        >
          {/* Widget Header */}
          <div
            className="px-5 py-4 text-white flex items-center justify-between gap-3"
            style={{ backgroundColor: theme.primaryColor }}
          >
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{theme.headerTitle || project.name}</h2>
              <p className="text-xs opacity-90 mt-0.5 truncate">{theme.subtitle || org.name}</p>
            </div>
            {historyEnabled && (
              <div className="flex items-center gap-1 shrink-0">
                <span
                  title="History enabled for customers"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white/15 rounded-md"
                >
                  <History className="w-3 h-3" aria-hidden="true" />
                  History
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewMsgs([])}
                  aria-label="Reset preview conversation"
                  title="New chat"
                  className="p-1.5 bg-white/15 hover:bg-white/25 rounded-md transition-colors"
                >
                  <SquarePen className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-700 leading-relaxed">
              {theme.welcomeMessage}
            </div>

            {previewMsgs.length === 0 && theme.starterPrompts.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {theme.starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendPreviewMessage(prompt)}
                    className="w-full text-left px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    style={{ color: theme.primaryColor }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {previewMsgs.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                  style={msg.role === 'user' ? { backgroundColor: theme.primaryColor } : undefined}
                >
                  {msg.content}
                </div>
                {msg.citations && msg.citations.length > 0 && (
                  <span className="text-[10px] text-slate-500 mt-1">
                    Sources: {msg.citations.join(' · ')}
                  </span>
                )}
              </div>
            ))}

            {previewSending && (
              <div className="text-xs text-slate-500 font-mono">Generating response...</div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendPreviewMessage(previewInput);
            }}
            className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Preview widget input"
              value={previewInput}
              onChange={(e) => setPreviewInput(e.target.value)}
              placeholder="Send a live preview message..."
              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
            />
            {voiceEnabled && (
              <span
                title={`Live voice enabled (${voiceName})`}
                className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 text-slate-600 bg-slate-50 shrink-0"
              >
                <Mic className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            )}
            <button
              type="submit"
              disabled={previewSending || !previewInput.trim()}
              aria-label="Send preview message"
              className="p-2 text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: theme.primaryColor }}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
