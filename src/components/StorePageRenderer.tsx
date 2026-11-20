import { Clock, Mail, MessageCircle } from 'lucide-react';
import type { StorePage, StorePageSection } from '../types';

interface StorePageRendererProps {
  page: StorePage;
  orgName: string;
  chatEnabled: boolean;
  onChatClick?: () => void;
}

function SectionBlock({ section, primaryColor }: { section: StorePageSection; primaryColor: string }) {
  if (!section.enabled) return null;

  if (section.type === 'hero') {
    return (
      <section
        className="relative overflow-hidden"
        style={{
          backgroundImage: section.imageUrl ? `url(${section.imageUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: section.imageUrl ? undefined : primaryColor,
        }}
      >
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative max-w-4xl mx-auto px-6 py-24 text-center text-white">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">{section.heading}</h1>
          {section.body && <p className="mt-4 text-base sm:text-lg text-white/90 whitespace-pre-line">{section.body}</p>}
        </div>
      </section>
    );
  }

  if (section.type === 'about') {
    return (
      <section className="max-w-4xl mx-auto px-6 py-14">
        <div className={`grid gap-8 items-center ${section.imageUrl ? 'md:grid-cols-2' : ''}`}>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{section.heading}</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 whitespace-pre-line">{section.body}</p>
          </div>
          {section.imageUrl && (
            <img src={section.imageUrl} alt={section.heading} className="rounded-2xl w-full object-cover aspect-[4/3]" />
          )}
        </div>
      </section>
    );
  }

  if (section.type === 'services' || section.type === 'gallery') {
    return (
      <section className="bg-slate-50 py-14">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 text-center">{section.heading}</h2>
          {section.body && <p className="mt-2 text-sm text-slate-600 text-center">{section.body}</p>}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {section.items.map((item, idx) => (
              <div key={idx} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                {item.imageUrl && (
                  <img src={item.imageUrl} alt={item.title} className="w-full aspect-[4/3] object-cover" />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    {item.price && (
                      <span className="text-sm font-bold whitespace-nowrap" style={{ color: primaryColor }}>
                        {item.price}
                      </span>
                    )}
                  </div>
                  {item.subtitle && <p className="mt-1 text-xs text-slate-500">{item.subtitle}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (section.type === 'hours') {
    return (
      <section className="max-w-2xl mx-auto px-6 py-14">
        <div className="flex items-center gap-2 justify-center">
          <Clock className="w-5 h-5" style={{ color: primaryColor }} />
          <h2 className="text-2xl font-bold text-slate-900">{section.heading}</h2>
        </div>
        {section.items.length > 0 ? (
          <div className="mt-6 divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white">
            {section.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium text-slate-800">{item.title}</span>
                <span className="text-slate-600">{item.subtitle}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600 text-center whitespace-pre-line">{section.body}</p>
        )}
      </section>
    );
  }

  // contact
  return (
    <section className="bg-slate-900 text-white py-14">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <div className="flex items-center gap-2 justify-center">
          <Mail className="w-5 h-5" style={{ color: primaryColor }} />
          <h2 className="text-2xl font-bold">{section.heading}</h2>
        </div>
        {section.body && <p className="mt-3 text-sm text-slate-300 whitespace-pre-line">{section.body}</p>}
        {section.items.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm">
            {section.items.map((item, idx) => (
              <div key={idx}>
                <span className="text-slate-400">{item.title}: </span>
                <span className="font-medium">{item.subtitle}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function StorePageRenderer({ page, orgName, chatEnabled, onChatClick }: StorePageRendererProps) {
  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {page.logoUrl && <img src={page.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />}
            <span className="text-sm font-bold text-slate-900 truncate">{page.title || orgName}</span>
          </div>
          {chatEnabled && onChatClick && (
            <button
              type="button"
              onClick={onChatClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white shrink-0"
              style={{ backgroundColor: page.primaryColor }}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Chat with us
            </button>
          )}
        </div>
      </header>

      {page.tagline && !page.sections.some((s) => s.type === 'hero' && s.enabled) && (
        <div className="max-w-4xl mx-auto px-6 pt-12 text-center">
          <h1 className="text-3xl font-bold text-slate-900">{page.title}</h1>
          <p className="mt-3 text-base text-slate-600">{page.tagline}</p>
        </div>
      )}

      {page.sections.map((section) => (
        <SectionBlock key={section.id} section={section} primaryColor={page.primaryColor} />
      ))}

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {orgName} · Powered by UAL
      </footer>
    </div>
  );
}