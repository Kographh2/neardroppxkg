'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { Brand } from '@/components/brand';
import { Spinner } from '@/components/primitives';
import { authClient } from '@/lib/auth';
import { api } from '@/lib/api';
import { platform } from '@/lib/platform-client';
export default function AuthPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = use(params); const signup = mode === 'sign-up'; const forgot = mode === 'forgot-password'; const reset = mode === 'reset-password';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => { setConfigured(!!authClient()); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); const auth = authClient(); if (!auth) return; setBusy(true); setError(''); setMessage('');
    try {
      if (forgot) { const result = await auth.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/reset-password` }); if (result.error) throw result.error; setMessage('If an account exists, you’ll receive a password reset link.'); }
      else if (reset) { const result = await auth.auth.updateUser({ password }); if (result.error) throw result.error; setMessage('Password updated. You can now sign in.'); }
      else if (signup) { const result = await auth.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/sign-in` } }); if (result.error) throw result.error; setMessage('Check your email to verify your account, then sign in.'); }
      else { const result = await auth.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; await platform.start(); await api('/auth/associate', { accessToken: result.data.session.access_token }); location.assign('/drop'); }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); } finally { setBusy(false); }
  }
  return <div className="auth-page"><header><Brand/><Link href="/drop" className="text-button"><ArrowLeft size={15}/> Back to NearDrop</Link></header><main id="main-content" className="auth-card surface"><span className="feature-icon"><Mail size={26}/></span><h1>{signup ? 'Make it a familiar place.' : forgot ? 'Let’s get you back in.' : reset ? 'A fresh start.' : 'Welcome back.'}</h1><p>{signup ? 'Keep your devices and transfer history together.' : forgot ? 'We’ll email you a link to reset your password.' : reset ? 'Choose a new, strong password.' : 'Your devices are right where you left them.'}</p>{configured === false ? <div className="auth-unconfigured"><ShieldCheck size={24}/><h2>Guest mode is ready.</h2><p>Accounts haven’t been enabled on this NearDrop server. You can pair devices and transfer files without signing in.</p><Link href="/drop" className="button primary">Continue as guest</Link></div> : configured && <form onSubmit={submit}>{!reset && <><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/></>}{!forgot && <><label htmlFor="password">Password</label><input id="password" type="password" minLength={signup || reset ? 12 : 1} maxLength={128} autoComplete={signup || reset ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder={signup || reset ? 'At least 12 characters' : 'Your password'}/></>}{error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}<button className="button primary" disabled={busy}>{busy && <Spinner/>}{signup ? 'Create account' : forgot ? 'Send reset link' : reset ? 'Update password' : 'Sign in'}</button>{!signup && !forgot && !reset && <Link href="/auth/forgot-password" className="text-button">Forgot password?</Link>}<p className="auth-switch">{signup ? 'Already have an account? ' : 'New to NearDrop? '}<Link href={signup ? '/auth/sign-in' : '/auth/sign-up'}>{signup ? 'Sign in' : 'Create account'}</Link></p></form>}<div className="auth-guest"><Link href="/drop">You can always continue as a guest <ArrowLeft size={13} style={{ transform: 'rotate(180deg)' }}/></Link></div></main></div>;
}
