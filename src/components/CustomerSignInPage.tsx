import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

interface CustomerSignInPageProps {
  orgSlug: string;
  botSlug: string;
}

// Top-level popup opened by the chat widget when a tool needs customer identity and
// the project enabled UAL-hosted sign-in. Runs Google auth outside the iframe (embedded
// iframes cannot use popup auth reliably), then hands the signed claim back via postMessage.
export function CustomerSignInPage({ orgSlug, botSlug }: CustomerSignInPageProps) {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const signIn = async () => {
    setPhase('working');
    setError('');
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch(
        `/api/public/bots/${encodeURIComponent(orgSlug)}/${encodeURIComponent(botSlug)}/identity/google`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      const data = (await res.json()) as { customerId?: string; sig?: string; ts?: number; error?: string };
      if (!res.ok || !data.customerId || !data.sig || !data.ts) {
        throw new Error(data.error || 'Sign-in failed.');
      }
      const claim = { type: 'ual-identity', customerId: data.customerId, sig: data.sig, ts: data.ts };
      if (window.opener) {
        window.opener.postMessage(claim, window.location.origin);
        setPhase('done');
        window.close();
      } else {
        const q = new URLSearchParams({ customerId: data.customerId, sig: data.sig, ts: String(data.ts) });
        window.location.href = `/c/${orgSlug}/${botSlug}?${q.toString()}`;
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center space-y-4">
        <div className="text-base font-semibold text-slate-800">Sign in to continue</div>
        <p className="text-sm text-slate-600 leading-relaxed">
          The assistant needs to know which customer you are before it can act on your account.
          Sign in with your Google account — verified by UAL on behalf of the business.
        </p>
        {phase === 'done' ? (
          <p className="text-sm text-emerald-700">Signed in. You can close this window.</p>
        ) : (
          <button
            type="button"
            onClick={signIn}
            disabled={phase === 'working'}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {phase === 'working' ? 'Signing in…' : 'Continue with Google'}
          </button>
        )}
        {phase === 'error' && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-[11px] text-slate-400">
          Your Google password is never shared with the business or stored by UAL.
        </p>
      </div>
    </div>
  );
}