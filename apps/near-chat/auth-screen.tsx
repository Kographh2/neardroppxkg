'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, Mail, MessageCircle, QrCode } from 'lucide-react';
import Link from 'next/link';
import { authClient } from '@/lib/auth';
import { chatApi } from './client-api';
export function AuthScreen({ onLogin, recovery=false }: { onLogin(): void; recovery?: boolean }) {
  const [mode,setMode]=useState<'login'|'register'|'forgot'|'reset'>(recovery?'reset':'login');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [link,setLink]=useState<{id:string;code:string;expiresAt:number}|null>(null),[qr,setQr]=useState(''),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);const subscription=authClient()?.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setMode('reset');});return()=>{clearInterval(timer);subscription?.data.subscription.unsubscribe();};},[]);
  useEffect(()=>{
    if(!link)return;let stopped=false,timer:ReturnType<typeof setTimeout>;
    void QRCode.toDataURL(`${location.origin}/near-chat?link=${link.code}`,{width:240,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(!stopped)setQr(value);});
    async function poll(){try {const result=await chatApi<{status:string}>(`/link/status?id=${link!.id}`);if(stopped)return;if(result.status==='approved'){onLogin();return;}}catch(cause){if(!stopped){setError(cause instanceof Error?cause.message:'Login link failed.');return;}}if(!stopped)timer=setTimeout(()=>void poll(),2000);}
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[link,onLogin]);
  async function submit(){setBusy(true);setError('');setNotice('');try{
    const auth=authClient();if(!auth)throw new Error('Account sign-in is not configured.');
    if(mode==='register'){const r=await auth.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/near-chat`}});if(r.error)throw r.error;setNotice('Check your email to verify your account, then sign in.');setMode('login');setPassword('');}
    else if(mode==='forgot'){const r=await auth.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/near-chat?recovery=1`});if(r.error)throw r.error;setNotice('If an account exists, a password reset link will arrive by email.');}
    else if(mode==='reset'){const r=await auth.auth.updateUser({password});if(r.error)throw r.error;setNotice('Password updated. You can sign in now.');setMode('login');setPassword('');}
    else {const r=await auth.auth.signInWithPassword({email,password});if(r.error)throw r.error;await chatApi('/session',{accessToken:r.data.session.access_token,name:matchMedia('(max-width:700px)').matches?'My phone':'My computer'});onLogin();}
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not sign in.');}finally{setBusy(false);}}
  return <main className="nc-auth"><header><Link href="/" className="nc-back"><ArrowLeft size={18}/> NearSpace</Link><span className="nc-wordmark"><MessageCircle/> NearChat</span></header><div className="nc-auth-grid"><section className="nc-auth-card"><span className="nc-kicker">YOUR PEOPLE, A LITTLE CLOSER</span><h1>{mode==='register'?'Make yourself at home.':mode==='forgot'?'Forgot your password?':mode==='reset'?'A fresh start.':'Good to see you.'}</h1><p>{mode==='register'?'Create your NearChat account.':'Sign in to your conversations.'}</p>
    <form onSubmit={e=>{e.preventDefault();void submit();}}>{mode!=='reset'&&<label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}{mode!=='forgot'&&<label>Password<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={8} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
    {error&&<p role="alert" className="nc-error">{error}</p>}{notice&&<p role="status" className="nc-notice">{notice}</p>}<button className="nc-primary" disabled={busy}>{busy?'Please wait…':mode==='register'?'Create account':mode==='forgot'?'Send reset link':mode==='reset'?'Save password':'Sign in'}</button></form>
    <div className="nc-auth-links"><button onClick={()=>{setMode(mode==='register'?'login':'register');setError('');}}>{mode==='register'?'Already have an account? Sign in':'New here? Create account'}</button><button onClick={()=>setMode(mode==='forgot'?'login':'forgot')}>{mode==='forgot'?'Back to sign in':'Forgot password?'}</button></div></section>
    <section className="nc-link-card"><QrCode size={28}/><h2>Already signed in on your phone?</h2><p>Link this screen from NearChat on a device you trust.</p>{link ? <>{qr&&<img src={qr} width={220} height={220} alt="Scan to request desktop sign-in"/>}<strong className="nc-pair-code">{link.code.slice(0,3)}-{link.code.slice(3)}</strong><p>{now<link.expiresAt?`Expires in ${Math.ceil((link.expiresAt-now)/1000)} seconds`:'This code expired.'}</p><button onClick={()=>{setLink(null);setQr('');}}>New login code</button></> : <button className="nc-secondary" onClick={()=>{setError('');void chatApi<{id:string;code:string;expiresAt:number}>('/link',{name:'Linked computer'}).then(setLink).catch(cause=>setError(cause.message));}}>Show QR & pairing code</button>}<small><Mail size={14}/> New users need to register and verify their email first.</small></section></div></main>;
}
