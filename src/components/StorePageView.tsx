import { useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import type { StorePage } from '../types';
import { StorePageRenderer } from './StorePageRenderer';

interface StorePageViewProps {
  orgSlug: string;
  botSlug: string;
}

interface PublicPageConfig {
  orgSlug: string;
  orgName: string;
  botSlug: string;
  page: StorePage;
  chatEnabled: boolean;
}

export function StorePageView({ orgSlug, botSlug }: StorePageViewProps) {
  const [config, setConfig] = useState<PublicPageConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/pages/${encodeURIComponent(orgSlug)}/${encodeURIComponent(botSlug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'load_failed');
        return res.json();
      })
      .then((data: PublicPageConfig) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, botSlug]);

  useEffect(() => {
    if (config) document.title = config.page.title || config.orgName;
  }, [config]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-lg font-bold text-slate-900">Page not available</p>
          <p className="text-sm text-slate-500">
            {loadError === 'not_found'
              ? 'This store page does not exist or has not been published yet.'
              : 'Something went wrong loading this page. Please try again later.'}
          </p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  // Forward verified customer identity params (if the business linked a signed-in visitor here)
  const params = new URLSearchParams(window.location.search);
  const chatParams = new URLSearchParams({ embed: '1' });
  for (const key of ['customerId', 'sig', 'ts']) {
    const value = params.get(key);
    if (value) chatParams.set(key, value);
  }
  const chatUrl = `/c/${encodeURIComponent(config.orgSlug)}/${encodeURIComponent(config.botSlug)}?${chatParams.toString()}`;

  return (
    <div className="min-h-screen bg-white">
      <StorePageRenderer
        page={config.page}
        orgName={config.orgName}
        chatEnabled={config.chatEnabled}
        onChatClick={() => setChatOpen(true)}
      />

      {config.chatEnabled && (
        <>
          {chatOpen && (
            <div className="fixed bottom-24 right-5 z-40 w-[min(24rem,calc(100vw-2.5rem))] h-[min(36rem,calc(100vh-8rem))] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white">
              <iframe src={chatUrl} title="Customer chat" className="w-full h-full border-0" />
            </div>
          )}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            aria-label={chatOpen ? 'Close chat' : 'Open chat'}
            className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full text-white shadow-xl flex items-center justify-center transition-transform hover:scale-105"
            style={{ backgroundColor: config.page.primaryColor }}
          >
            {chatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
          </button>
        </>
      )}
    </div>
  );
}