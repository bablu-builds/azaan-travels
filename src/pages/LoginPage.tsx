import { useState, useEffect } from 'react';
import { useAuth, consumeDeactivatedFlag } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import {
  signInWithEmailAndPassword, isSignInWithEmailLink, signInWithEmailLink,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, authReady, rememberAuthSession } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import logoImg from '@/assets/logo.jpg';
import { useSettings } from '@/contexts/SettingsContext';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';

const EMAIL_LINK_KEY = 'azaan_signin_email';

// ── Branded hero panel (left side, desktop only) ──────────────────
function HeroPanel({ shopName }: { shopName: string }) {
  return (
    <div
      className="hidden lg:flex lg:w-[58%] relative overflow-hidden flex-col justify-between p-12"
      style={{ background: 'hsl(var(--sidebar))' }}
    >
      {/* Floating gradient blobs */}
      <div className="login-blob login-blob-1" aria-hidden="true" />
      <div className="login-blob login-blob-2" aria-hidden="true" />
      <div className="login-blob login-blob-3" aria-hidden="true" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-white overflow-hidden flex items-center justify-center shadow-md">
          <img src={logoImg} alt="AZAAN" className="h-9 w-9 object-contain" />
        </div>
        <span className="text-white/60 text-sm font-medium tracking-wide">CSC Management Portal</span>
      </div>

      {/* Centre — main branding */}
      <div className="relative z-10 space-y-5">
        {/* Full logo on white card */}
        <div className="bg-white rounded-2xl p-4 inline-block shadow-2xl">
          <img src={logoImg} alt="AZAAN Communication Tour and Travel" className="h-40 object-contain" />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/70 text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          Secure Staff Access
        </div>

        <p className="text-white/55 text-lg font-medium" style={{ fontFamily: 'var(--app-font-display)' }}>
          CSC Management, simplified.
        </p>
        <p className="text-white/35 text-sm">
          Track work &nbsp;·&nbsp; Manage customers &nbsp;·&nbsp; Monitor earnings
        </p>

        {/* Decorative feature pills */}
        <div className="flex flex-wrap gap-2 pt-2">
          {['Work Entries', 'Financial Services', 'Staff Roles', 'Reports'].map(f => (
            <span
              key={f}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/8 border border-white/12 text-white/50"
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="relative z-10 text-white/25 text-xs">
        Protected by Firebase Authentication
      </div>
    </div>
  );
}

// ── Full-screen loading screens ───────────────────────────────────
function FullScreenLoader({ message }: { message?: string }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        {message && <p className="text-muted-foreground font-medium text-sm">{message}</p>}
      </div>
    </div>
  );
}

// ── Email-link confirm screen ─────────────────────────────────────
function EmailLinkConfirmScreen({
  emailLinkEmail, setEmailLinkEmail, onSubmit,
}: {
  emailLinkEmail: string;
  setEmailLinkEmail: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center p-4 bg-background"
      style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--border)) 1px, transparent 0)', backgroundSize: '28px 28px' }}
    >
      <div className="max-w-md w-full bg-card border rounded-2xl shadow-lg overflow-hidden animate-fade-in-up">
        <div className="p-8 text-center border-b">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
            <Mail className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">Confirm Your Email</h1>
          <p className="text-muted-foreground text-sm mt-2">
            You're signing in via an email link. Please confirm your email address to continue.
          </p>
        </div>
        <form onSubmit={onSubmit} className="p-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="confirm-email">Your Email Address</Label>
            <Input
              id="confirm-email" type="email" placeholder="staff@example.com"
              value={emailLinkEmail} onChange={e => setEmailLinkEmail(e.target.value)}
              required autoFocus
            />
          </div>
          <Button type="submit" className="w-full">Continue Sign-in</Button>
        </form>
      </div>
    </div>
  );
}

// ── Main login page ───────────────────────────────────────────────
export default function LoginPage() {
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [loading, setLoading]         = useState(false);
  const [resetSent, setResetSent]     = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [isDeactivated, setIsDeactivated] = useState(false);
  const [loginError, setLoginError]   = useState<string | null>(null);
  const [errorCount, setErrorCount]   = useState(0); // key-bump → re-triggers shake animation

  const { isConfigured, user, loading: authLoading } = useAuth();
  const { shopSettings } = useSettings();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Email-link sign-in state
  const [isEmailLink, setIsEmailLink]           = useState(false);
  const [emailLinkEmail, setEmailLinkEmail]     = useState('');
  const [emailLinkLoading, setEmailLinkLoading] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  useEffect(() => {
    if (consumeDeactivatedFlag()) setIsDeactivated(true);
  }, []);

  useEffect(() => {
    if (!authLoading && user) setLocation('/dashboard');
  }, [user, authLoading, setLocation]);

  useEffect(() => {
    if (!auth) return;
    if (isSignInWithEmailLink(auth, window.location.href)) {
      setIsEmailLink(true);
      const stored = window.localStorage.getItem(EMAIL_LINK_KEY);
      if (stored) {
        setEmailLinkEmail(stored);
        completeEmailLinkSignIn(stored);
      } else {
        setNeedsEmailConfirm(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeEmailLinkSignIn = async (signinEmail: string) => {
    if (!auth || !db) return;
    setEmailLinkLoading(true);
    try {
      await authReady;
      const result = await signInWithEmailLink(auth, signinEmail, window.location.href);
      await rememberAuthSession();
      window.localStorage.removeItem(EMAIL_LINK_KEY);

      const uid = result.user.uid;
      const profileRef = doc(db, 'users', uid);
      const existing = await getDoc(profileRef);
      if (!existing.exists()) {
        const inviteRef = doc(db, 'pendingInvites', signinEmail.replace(/[.]/g, ','));
        const invite = await getDoc(inviteRef).catch(() => null);
        await setDoc(profileRef, {
          email: signinEmail,
          displayName: signinEmail.split('@')[0],
          role: 'staff',
          createdAt: Timestamp.now(),
          isActive: true,
          canManageWork: true,
          canAccessFinancialServices: false,
          canAccessQuickWork: false,
          canViewDeletedItems: false,
          ...(invite?.exists() ? { invitedBy: invite.data()?.invitedBy } : {}),
        });
        if (invite?.exists()) {
          const { deleteDoc } = await import('firebase/firestore');
          await deleteDoc(inviteRef).catch(() => {});
        }
      }
      toast({ title: 'Welcome!', description: 'You have been signed in successfully.' });
      setLocation('/dashboard');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Sign-in Failed', description: err.message });
      setEmailLinkLoading(false);
      setIsEmailLink(false);
    }
  };

  const handleEmailLinkConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    completeEmailLinkSignIn(emailLinkEmail);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setIsDeactivated(false);
    setLoginError(null);
    setLoading(true);
    try {
      await authReady;
      await signInWithEmailAndPassword(auth, email, password);
      await rememberAuthSession();
      setLocation('/dashboard');
    } catch (err: any) {
      const friendlyMsg =
        err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
          ? 'Incorrect email or password. Please try again.'
          : err.code === 'auth/user-disabled'
          ? 'This account has been disabled. Contact the shop owner.'
          : err.code === 'auth/too-many-requests'
          ? 'Too many failed attempts. Please wait a moment and try again.'
          : err.message;
      setLoginError(friendlyMsg);
      setErrorCount(c => c + 1); // bumps key → remounts element → CSS animation re-runs
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!auth || !email.trim()) {
      toast({
        variant: 'destructive',
        title: 'Enter your email first',
        description: 'Type your email address above, then click Forgot Password.',
      });
      return;
    }
    setSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
      toast({ title: 'Reset email sent', description: `Check ${email} for a password reset link.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSendingReset(false);
    }
  };

  // ── Early returns ──────────────────────────────────────────────
  if (authLoading) return <FullScreenLoader />;
  if (user) return null;
  if (isEmailLink && emailLinkLoading) return <FullScreenLoader message="Signing you in…" />;
  if (isEmailLink && needsEmailConfirm) {
    return (
      <EmailLinkConfirmScreen
        emailLinkEmail={emailLinkEmail}
        setEmailLinkEmail={setEmailLinkEmail}
        onSubmit={handleEmailLinkConfirm}
      />
    );
  }

  const displayName = shopSettings?.shopName || 'AZAAN COMMUNICATION TOUR AND TRAVEL';

  // ── Main split-screen render ───────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex">
      {/* Left — hero panel */}
      <HeroPanel shopName={displayName} />

      {/* Right — login form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 lg:px-16 bg-background">

        {/* Mobile-only branding header */}
        <div
          className="lg:hidden mb-8 flex flex-col items-center gap-3 animate-fade-in-up"
          style={{ animationDelay: '0ms' }}
        >
          <div className="h-20 w-20 rounded-2xl bg-white overflow-hidden flex items-center justify-center shadow-lg">
            <img src={logoImg} alt="AZAAN" className="h-18 w-18 object-contain" />
          </div>
          <div className="text-center">
            <div
              className="font-extrabold text-base leading-tight"
              style={{ fontFamily: 'var(--app-font-display)' }}
            >
              {displayName.split(' ').slice(0, 2).join(' ')}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">CSC Management, simplified</div>
          </div>
        </div>

        <div className="w-full max-w-sm">

          {/* Setup warning */}
          {!isConfigured && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl mb-6 text-sm animate-fade-in-up">
              <strong>Setup Required</strong> — Firebase secrets not yet configured.
            </div>
          )}

          {/* Deactivated banner */}
          {isDeactivated && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl mb-6 text-sm flex items-start gap-3 animate-shake">
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
              <div>
                <p className="font-semibold">Account Deactivated</p>
                <p className="mt-0.5 text-rose-700">Your account has been deactivated. Please contact the shop owner to regain access.</p>
              </div>
            </div>
          )}

          {/* Desktop logo + heading */}
          <div
            className="hidden lg:flex items-center gap-3 mb-8 animate-fade-in-up"
            style={{ animationDelay: '0ms' }}
          >
            <div className="h-11 w-11 rounded-xl bg-white overflow-hidden flex items-center justify-center shadow-md">
              <img src={logoImg} alt="AZAAN" className="h-10 w-10 object-contain" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight" style={{ fontFamily: 'var(--app-font-display)' }}>
                {displayName.split(' ').slice(0, 2).join(' ')}
              </div>
              <div className="text-xs text-muted-foreground">Staff Portal</div>
            </div>
          </div>

          {/* Heading */}
          <div
            className="mb-7 animate-fade-in-up"
            style={{ animationDelay: '60ms' }}
          >
            <h2
              className="text-2xl font-bold tracking-tight"
              style={{ fontFamily: 'var(--app-font-display)' }}
            >
              Welcome back
            </h2>
            <p className="text-muted-foreground text-sm mt-1">Sign in to access your dashboard</p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4" noValidate>

            {/* Email */}
            <div
              className="space-y-1.5 animate-fade-in-up"
              style={{ animationDelay: '120ms' }}
            >
              <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
              <Input
                id="email" type="email" placeholder="staff@example.com"
                value={email} onChange={e => { setEmail(e.target.value); setLoginError(null); }}
                required disabled={!isConfigured || loading}
                className="h-11 transition-shadow focus-visible:shadow-sm"
                data-testid="input-email"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div
              className="space-y-1.5 animate-fade-in-up"
              style={{ animationDelay: '180ms' }}
            >
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password" type="password"
                value={password} onChange={e => { setPassword(e.target.value); setLoginError(null); }}
                required disabled={!isConfigured || loading}
                className="h-11 transition-shadow focus-visible:shadow-sm"
                data-testid="input-password"
                autoComplete="current-password"
              />
            </div>

            {/* Inline error with shake */}
            {loginError && (
              <div
                key={errorCount}
                className="animate-shake flex items-start gap-2.5 bg-destructive/8 border border-destructive/25 text-destructive rounded-lg px-3.5 py-2.5 text-sm"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            {/* Forgot password */}
            <div
              className="flex items-center justify-between animate-fade-in-up"
              style={{ animationDelay: '240ms' }}
            >
              <button
                type="button" onClick={handleForgotPassword}
                disabled={sendingReset || !isConfigured}
                className="text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {sendingReset
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Sending…</>
                  : 'Forgot password?'}
              </button>
              {resetSent && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Reset email sent
                </span>
              )}
            </div>

            {/* Submit button */}
            <div
              className="animate-fade-in-up pt-1"
              style={{ animationDelay: '300ms' }}
            >
              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold shadow-md shadow-primary/20
                           hover:shadow-lg hover:shadow-primary/30 hover:scale-[1.015]
                           active:scale-[0.985] transition-all duration-150"
                disabled={!isConfigured || loading}
                data-testid="button-login"
              >
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Signing in…</>
                  : 'Sign In'}
              </Button>
            </div>
          </form>

          {/* Footer note */}
          <p
            className="mt-7 text-center text-xs text-muted-foreground animate-fade-in-up"
            style={{ animationDelay: '380ms' }}
          >
            Staff members can also sign in via the email link sent by the owner.
          </p>
        </div>
      </div>
    </div>
  );
}
