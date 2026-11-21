import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  History,
  MessageSquare,
  Plus,
  Send,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatTheme, ChatTurnMessage, CustomerConversationThread, CustomerIdentityClaim } from '../types';
import {
  buildHistoryStorageKey,
  clearCustomerThreads,
  createThreadId,
  DEFAULT_HISTORY_RETENTION_DAYS,
  deleteConversationThread,
  formatRelativeThreadTime,
  loadCustomerThreads,
  saveCustomerThreads,
  upsertConversationThread,
} from '../utils/customerHistory';
import { normalizeVoiceName } from '../utils/voiceAudio';
import { useLiveVoiceSession } from '../hooks/useLiveVoiceSession';
import { LiveVoiceDock } from './LiveVoiceDock';

interface HostedChatPageProps {
  orgSlug: string;
  botSlug: string;
  isEmbed: boolean;
  onBackToConsole: () => void;
}

interface PublicBotPayload {
  orgSlug: string;
  orgName: string;
  mcpToolCount: number;
  project: {
    id: string;
    name: string;
    slug: string;
    description: string;
    status: string;
    theme: ChatTheme;
    sourceCount: number;
    chunkCount: number;
    hostedSignIn?: boolean;
  };
}

export function HostedChatPage({
  orgSlug,
  botSlug,
  isEmbed,
  onBackToConsole,
}: HostedChatPageProps) {
  const [bot, setBot] = useState<PublicBotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Active thread & conversation history state
  const [threads, setThreads] = useState<CustomerConversationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>(() => createThreadId());
  const [messages, setMessages] = useState<ChatTurnMessage[]>([]);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceDockOpen, setVoiceDockOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = useRef<string>(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  // Signed customer identity (HMAC) arrives via URL params or a postMessage handoff
  // from the host page, and survives reloads within the tab session.
  const [customerIdentity, setCustomerIdentity] = useState<CustomerIdentityClaim | null>(() => {
    if (typeof window === 'undefined') return null;
    const storageKey = `ual_identity_${orgSlug}_${botSlug}`;
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get('customerId') || params.get('customer');
    const sig = params.get('sig');
    const ts = Number(params.get('ts') ?? 0);
    if (customerId && sig && ts) {
      const claim: CustomerIdentityClaim = { customerId, sig, ts };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(claim));
      } catch {
        // Storage unavailable; identity still usable for this page load
      }
      return claim;
    }
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as CustomerIdentityClaim) : null;
    } catch {
      return null;
    }
  });

  const customerScope = customerIdentity?.customerId ?? null;

  // Host pages hand off a signed identity after their own sign-in (e.g. Google) without
  // reloading the widget. The HMAC signature is still verified server-side on every chat.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Host handoff comes from the embedding parent; the sign-in popup is a
      // same-origin child window, not the parent, so accept it by origin.
      const fromHost = window.parent !== window && event.source === window.parent;
      const fromSignInPopup = event.origin === window.location.origin;
      if (!fromHost && !fromSignInPopup) return;
      const data = event.data as { type?: unknown; customerId?: unknown; sig?: unknown; ts?: unknown } | null;
      if (!data || data.type !== 'ual-identity') return;
      const customerId = typeof data.customerId === 'string' ? data.customerId : '';
      const sig = typeof data.sig === 'string' ? data.sig : '';
      const ts = Number(data.ts);
      if (!customerId || !sig || !Number.isFinite(ts)) return;
      const claim: CustomerIdentityClaim = { customerId, sig, ts };
      setCustomerIdentity(claim);
      try {
        sessionStorage.setItem(`ual_identity_${orgSlug}_${botSlug}`, JSON.stringify(claim));
      } catch {
        // Storage unavailable; identity still usable for this page load
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [orgSlug, botSlug]);

  const storageKey = useMemo(
    () => buildHistoryStorageKey(orgSlug, botSlug, customerScope),
    [orgSlug, botSlug, customerScope]
  );

  const historyEnabled = bot?.project.theme.enableCustomerHistory !== false;
  const retentionDays = bot?.project.theme.historyRetentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
  const voiceEnabled = Boolean(bot?.project.theme.enableVoiceMode);
  const configuredVoiceName = normalizeVoiceName(bot?.project.theme.voiceName);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    fetch(`/api/public/bots/${encodeURIComponent(orgSlug)}/${encodeURIComponent(botSlug)}`)
      .then(async (res) => {
        const data = (await res.json()) as PublicBotPayload & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Chatbot service not found.');
        if (!active) return;
        setBot(data);

        const canUseHistory = data.project.theme.enableCustomerHistory !== false;
        const retention = data.project.theme.historyRetentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
        if (canUseHistory) {
          const saved = loadCustomerThreads(storageKey, retention);
          setThreads(saved);
          if (saved.length > 0) {
            setActiveThreadId(saved[0].id);
            setMessages(saved[0].messages);
          } else {
            setActiveThreadId(createThreadId());
            setMessages([]);
          }
        } else {
          setThreads([]);
          setActiveThreadId(createThreadId());
          setMessages([]);
          setHistoryDrawerOpen(false);
        }
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Unable to load chatbot.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orgSlug, botSlug, storageKey]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const persistMessagesToHistory = useCallback(
    (threadId: string, updatedMessages: ChatTurnMessage[]) => {
      if (!historyEnabled || updatedMessages.length === 0) return;
      const nowIso = new Date().toISOString();
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === threadId);
        const nextThreads = upsertConversationThread(
          prev,
          {
            id: threadId,
            title: existing?.title || '',
            createdAt: existing?.createdAt || nowIso,
            updatedAt: nowIso,
            messages: updatedMessages,
          },
          retentionDays
        );
        saveCustomerThreads(storageKey, nextThreads, retentionDays);
        return nextThreads;
      });
    },
    [historyEnabled, retentionDays, storageKey]
  );

  const handleVoiceTurnComplete = useCallback(
    ({ userText, assistantText }: { userText: string; assistantText: string }) => {
      const additions: ChatTurnMessage[] = [];
      if (userText) additions.push({ role: 'user', content: userText });
      if (assistantText) additions.push({ role: 'assistant', content: assistantText });
      if (additions.length === 0) return;
      setMessages((prev) => {
        const updated = [...prev, ...additions];
        persistMessagesToHistory(activeThreadIdRef.current, updated);
        return updated;
      });
    },
    [persistMessagesToHistory]
  );

  const voice = useLiveVoiceSession({
    orgSlug,
    botSlug: bot?.project.slug || botSlug,
    channel: isEmbed ? 'widget' : 'hosted',
    onTurnComplete: handleVoiceTurnComplete,
  });

  const handleOpenVoiceMode = () => {
    if (!voiceEnabled) return;
    setHistoryDrawerOpen(false);
    setVoiceDockOpen(true);
    void voice.startSession();
  };

  const handleCloseVoiceMode = () => {
    voice.stopSession();
    setVoiceDockOpen(false);
  };

  const handleStartNewChat = () => {
    setActiveThreadId(createThreadId());
    setMessages([]);
    setHistoryDrawerOpen(false);
    setConfirmClearAll(false);
  };

  const handleSelectThread = (thread: CustomerConversationThread) => {
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setHistoryDrawerOpen(false);
    setConfirmClearAll(false);
  };

  const handleDeleteThread = (threadId: string) => {
    setThreads((prev) => {
      const next = deleteConversationThread(prev, threadId);
      saveCustomerThreads(storageKey, next, retentionDays);
      if (threadId === activeThreadId) {
        if (next.length > 0) {
          setActiveThreadId(next[0].id);
          setMessages(next[0].messages);
        } else {
          setActiveThreadId(createThreadId());
          setMessages([]);
        }
      }
      return next;
    });
  };

  const handleClearAllHistory = () => {
    clearCustomerThreads(storageKey);
    setThreads([]);
    setActiveThreadId(createThreadId());
    setMessages([]);
    setConfirmClearAll(false);
    setHistoryDrawerOpen(false);
  };

  const sendMessage = async (text: string) => {
    const clean = text.trim();
    if (!clean || !bot || sending) return;
    const threadId = activeThreadId;
    const next: ChatTurnMessage[] = [...messages, { role: 'user', content: clean }];
    setMessages(next);
    persistMessagesToHistory(threadId, next);
    setInput('');
    setSending(true);

    try {
      const res = await fetch(`/api/v1/bots/${encodeURIComponent(orgSlug)}/${encodeURIComponent(bot.project.slug)}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RelayMesh-Channel': isEmbed ? 'widget' : 'hosted',
        },
        body: JSON.stringify({
          message: clean,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          ...(customerIdentity ? { customerIdentity } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const completed: ChatTurnMessage[] = [
        ...next,
        {
          role: 'assistant',
          content: data.reply,
          citations: data.citations ?? [],
          mcpCalls: data.mcpCalls ?? [],
          latencyMs: data.latencyMs,
          tokens: data.usage?.totalTokens ?? 0,
          loginRequired: data.loginRequired ?? undefined,
        },
      ];
      setMessages(completed);
      persistMessagesToHistory(threadId, completed);
    } catch (err) {
      const withError: ChatTurnMessage[] = [
        ...next,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Request failed.',
        },
      ];
      setMessages(withError);
      persistMessagesToHistory(threadId, withError);
    } finally {
      setSending(false);
    }
  };

  // Once a signed identity arrives (popup or host handoff), resume the request that was
  // blocked by the sign-in gate so the visitor does not have to retype it.
  const prevIdentityRef = useRef<CustomerIdentityClaim | null>(customerIdentity);
  useEffect(() => {
    const previous = prevIdentityRef.current;
    prevIdentityRef.current = customerIdentity;
    if (previous || !customerIdentity) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastAssistant?.loginRequired && lastUser) void sendMessage(lastUser.content);
  }, [customerIdentity, messages, sendMessage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <p className="text-sm text-slate-500">Loading hosted chatbot service...</p>
      </div>
    );
  }

  if (loadError || !bot) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-center">
          <h1 className="text-base font-semibold text-slate-900">Service Not Found</h1>
          <p className="text-sm text-slate-600">{loadError || 'This hosted chatbot URL is not active.'}</p>
          {!isEmbed && (
            <button
              type="button"
              onClick={onBackToConsole}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Return to UAL Console
            </button>
          )}
        </div>
      </div>
    );
  }

  const { theme } = bot.project;

  return (
    <div
      className={`${isEmbed ? 'h-screen' : 'min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 sm:p-8'}`}
    >
      <div
        className={`relative w-full flex flex-col overflow-hidden ${
          isEmbed
            ? 'h-full'
            : 'max-w-3xl h-[84vh] bg-white border border-slate-200 shadow-sm'
        }`}
        style={{
          backgroundColor: theme.surfaceColor,
          color: theme.textColor,
          borderRadius: isEmbed ? 0 : `${theme.borderRadius}px`,
        }}
      >
        {/* Branded Header */}
        <header
          className="px-5 py-4 text-white flex items-center justify-between gap-3 shrink-0"
          style={{ backgroundColor: theme.primaryColor }}
        >
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{theme.headerTitle || bot.project.name}</h1>
            <p className="text-xs opacity-90 truncate">
              {theme.subtitle || bot.orgName} · {bot.project.chunkCount} indexed chunks · {bot.mcpToolCount} MCP tools
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {historyEnabled && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryDrawerOpen((v) => !v);
                    setConfirmClearAll(false);
                  }}
                  aria-expanded={historyDrawerOpen}
                  aria-label="Conversation history"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <History className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>History</span>
                  {threads.length > 0 && (
                    <span className="font-mono tabular-nums text-[11px] opacity-90">
                      ({threads.length})
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStartNewChat}
                  aria-label="Start new conversation"
                  title="New chat"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <SquarePen className="w-3.5 h-3.5" aria-hidden="true" />
                  {!isEmbed && <span>New Chat</span>}
                </button>
              </>
            )}
            {!isEmbed && (
              <button
                type="button"
                onClick={onBackToConsole}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                Back to Console
              </button>
            )}
          </div>
        </header>

        {/* Main Chat Body + Optional Slide-Over History Drawer */}
        <div className="relative flex-1 flex overflow-hidden">
          {historyEnabled && historyDrawerOpen && (
            <>
              <div
                onClick={() => setHistoryDrawerOpen(false)}
                className="absolute inset-0 bg-slate-900/25 z-10"
                aria-hidden="true"
              />
              <aside
                aria-label="Past conversations"
                className="absolute inset-y-0 left-0 z-20 w-[290px] max-w-[85%] bg-white border-r border-slate-200 shadow-lg flex flex-col"
              >
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold text-slate-900">Conversation History</h2>
                    <p className="text-[11px] text-slate-500">
                      Saved locally for {retentionDays} days
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHistoryDrawerOpen(false)}
                    aria-label="Close history panel"
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="p-3 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-95"
                    style={{ backgroundColor: theme.primaryColor }}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    New Conversation
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                  {threads.length === 0 ? (
                    <div className="p-6 text-center space-y-1.5">
                      <MessageSquare className="w-5 h-5 text-slate-300 mx-auto" aria-hidden="true" />
                      <p className="text-xs font-medium text-slate-700">No saved conversations yet</p>
                      <p className="text-[11px] text-slate-500">
                        Your chats will appear here automatically so you can pick up where you left off.
                      </p>
                    </div>
                  ) : (
                    threads.map((thread) => {
                      const isActive = thread.id === activeThreadId;
                      return (
                        <div
                          key={thread.id}
                          className={`group flex items-start justify-between gap-2 px-3.5 py-3 transition-colors ${
                            isActive ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectThread(thread)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <p
                              className={`text-xs truncate ${
                                isActive ? 'font-semibold text-slate-950' : 'font-medium text-slate-800'
                              }`}
                            >
                              {thread.title}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                              {thread.messages.length} msgs · {formatRelativeThreadTime(thread.updatedAt)}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteThread(thread.id)}
                            aria-label={`Delete conversation ${thread.title}`}
                            className="p-1 text-slate-400 hover:text-red-600 rounded shrink-0 opacity-75 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {threads.length > 0 && (
                  <div className="p-3 border-t border-slate-200 bg-slate-50/70">
                    {confirmClearAll ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-600">Clear all threads?</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConfirmClearAll(false)}
                            className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleClearAllHistory}
                            className="px-2 py-1 text-[11px] font-medium text-white bg-red-600 rounded hover:bg-red-700"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 bg-white border border-slate-200 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Clear History
                      </button>
                    )}
                  </div>
                )}
              </aside>
            </>
          )}

          {/* Optional Real-Time Live Voice Overlay */}
          {voiceEnabled && voiceDockOpen && (
            <LiveVoiceDock
              primaryColor={theme.primaryColor}
              botName={theme.headerTitle || bot.project.name}
              voiceName={voice.activeVoiceName || configuredVoiceName}
              status={voice.status}
              muted={voice.muted}
              activeTool={voice.activeTool}
              inputLevel={voice.inputLevel}
              outputLevel={voice.outputLevel}
              liveUserTranscript={voice.liveUserTranscript}
              liveAssistantTranscript={voice.liveAssistantTranscript}
              error={voice.error}
              onToggleMute={voice.toggleMute}
              onRetry={() => void voice.startSession()}
              onEnd={handleCloseVoiceMode}
            />
          )}

          {/* Transcript */}
          <main className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 leading-relaxed max-w-[85%]">
              {theme.welcomeMessage}
            </div>

            {messages.length === 0 && theme.starterPrompts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {theme.starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-left"
                    style={{ color: theme.primaryColor }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                  style={msg.role === 'user' ? { backgroundColor: theme.primaryColor } : undefined}
                >
                  {msg.content}
                </div>

                {msg.role === 'assistant' && (
                  <div className="mt-1.5 space-y-1 max-w-[85%]">
                    {msg.loginRequired && (
                      bot.project.hostedSignIn ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              `/customer-signin/${orgSlug}/${botSlug}`,
                              'ual-customer-signin',
                              'width=480,height=640'
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg shadow-sm"
                          style={{ backgroundColor: theme.primaryColor }}
                        >
                          Sign in with Google
                        </button>
                      ) : msg.loginRequired.loginUrl ? (
                        <button
                          type="button"
                          onClick={() => window.open(msg.loginRequired!.loginUrl, '_blank', 'noopener')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg shadow-sm"
                          style={{ backgroundColor: theme.primaryColor }}
                        >
                          Sign in to access your account
                        </button>
                      ) : (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
                          This action needs your customer account. Sign in on the company website, then ask again here.
                        </div>
                      )
                    )}
                    {msg.citations && msg.citations.length > 0 && (
                      <p className="text-[11px] text-slate-500">
                        Sources: {msg.citations.join(' · ')}
                      </p>
                    )}
                    {msg.mcpCalls && msg.mcpCalls.length > 0 && (
                      <div className="text-[11px] font-mono text-slate-700 bg-white border border-slate-200 rounded-md px-2.5 py-1">
                        {msg.mcpCalls.map((call, i) => (
                          <div key={i}>
                            Tool {call.toolName} ({call.durationMs}ms · {call.status})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="text-xs font-mono text-slate-500">Thinking and checking connected tools...</div>
            )}
            <div ref={transcriptEndRef} />
          </main>
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="p-4 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            aria-label="Message chatbot"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
          />
          {voiceEnabled && (
            <button
              type="button"
              onClick={handleOpenVoiceMode}
              aria-label="Start live voice mode"
              title={`Live Voice (${configuredVoiceName})`}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <AudioLines className="w-4 h-4" style={{ color: theme.primaryColor }} aria-hidden="true" />
              {!isEmbed && <span>Voice</span>}
            </button>
          )}
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: theme.primaryColor }}
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
