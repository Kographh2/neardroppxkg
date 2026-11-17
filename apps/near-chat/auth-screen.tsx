'use client';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, ChevronDown, Globe, Mail, MessageCircle, Phone, QrCode } from 'lucide-react';
import Link from 'next/link';
import { authClient } from '@/lib/auth';
import { chatApi } from './client-api';

const COUNTRIES = [
  {name:'Indonesia', dial:'+62', code:'ID'},
  {name:'United States', dial:'+1', code:'US'},
  {name:'United Kingdom', dial:'+44', code:'GB'},
  {name:'Singapore', dial:'+65', code:'SG'},
  {name:'Malaysia', dial:'+60', code:'MY'},
  {name:'Australia', dial:'+61', code:'AU'},
  {name:'Japan', dial:'+81', code:'JP'},
  {name:'South Korea', dial:'+82', code:'KR'},
  {name:'India', dial:'+91', code:'IN'},
  {name:'Germany', dial:'+49', code:'DE'},
  {name:'Other', dial:'+', code:'OTHER'},
];

export function AuthScreen({ onLogin, recovery=false }: { onLogin(): void; recovery?: boolean }) {
  const [mode,setMode]=useState<'login'|'register'|'forgot'|'reset'|'number'>(recovery?'reset':'login');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [link,setLink]=useState<{id:string;code:string;expiresAt:number}|null>(null),[qr,setQr]=useState(''),[now,setNow]=useState(Date.now());
  const [country,setCountry]=useState(COUNTRIES[0]),[otherDial,setOtherDial]=useState('+1'),[customPhone,setCustomPhone]=useState(''),[showCountries,setShowCountries]=useState(false);
  const dial = country.code==='OTHER'?otherDial:country.dial;

  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);const subscription=authClient()?.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setMode('reset');});return()=>{clearInterval(timer);subscription?.data.subscription.unsubscribe();};},[]);
  useEffect(()=>{
    if(!link)return;let stopped=false,timer:ReturnType<typeof setTimeout>;
    void QRCode.toDataURL(`${location.origin}/near-chat?link=${link.code}`,{width:240,margin:2,errorCorrectionLevel:'M'}).then(value=>{if(!stopped)setQr(value);});
    async function poll(){try {const result=await chatApi<{status:string}>(`/link/status?id=${link!.id}`);if(stopped)return;if(result.status==='approved'){onLogin();return;}}catch(cause){if(!stopped){setError(cause instanceof Error?cause.message:'Login link failed.');return;}}if(!stopped)timer=setTimeout(()=>void poll(),2000);}
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[link,onLogin]);

  async function getNumber(){setBusy(true);setError('');try{
    const r=await chatApi<{phone?:string;needsPhone?:boolean}>('/number',{country:country.code,dial});
    if(r.phone){setNotice(`Your number: ${r.phone}`); onLogin();}
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not get number.');}finally{setBusy(false);}}

  async function submit(){setBusy(true);setError('');setNotice('');try{
    const auth=authClient();if(!auth)throw new Error('Account sign-in is not configured.');
    if(mode==='register'){const r=await auth.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/near-chat`}});if(r.error)throw r.error;setNotice('Check your email to verify your account, then sign in. After sign-in you can get a number.');setMode('login');setPassword('');}
    else if(mode==='forgot'){const r=await auth.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/near-chat?recovery=1`});if(r.error)throw r.error;setNotice('If an account exists, a password reset link will arrive by email.');}
    else if(mode==='reset'){const r=await auth.auth.updateUser({password});if(r.error)throw r.error;setNotice('Password updated. You can sign in now.');setMode('login');setPassword('');}
    else {
      const r=await auth.auth.signInWithPassword({email,password});if(r.error)throw r.error;
      const res=await chatApi<{ok?:boolean;needsPhone?:boolean}>('/session',{accessToken:r.data.session.access_token,name:matchMedia('(max-width:700px)').matches?'My phone':'My computer'});
      if(res.needsPhone){setMode('number');} else onLogin();
    }
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not sign in.');}finally{setBusy(false);}}

  if(mode==='number') return <main className="nc-auth"><header><Link href="/" className="nc-back"><ArrowLeft size={18}/> NearSpace</Link><span className="nc-wordmark"><MessageCircle/> NearChat</span></header><div className="nc-auth-grid single"><section className="nc-auth-card"><span className="nc-kicker">CHOOSE YOUR NUMBER</span><h1>Get your NearChat number.</h1><p>Pick a country to generate a number for registration. Indonesia numbers use the fixed +62 country code.</p>
    <div className="nc-form" style={{marginTop:20}}>
      <label>Country / region<div className="nc-select" onClick={()=>setShowCountries(v=>!v)}><Globe size={16}/><span>{country.name} ({dial||country.dial})</span><ChevronDown size={16}/></div></label>
      {showCountries&&<div className="nc-country-list">{COUNTRIES.map(c=><button key={c.code} type="button" onClick={()=>{setCountry(c);setShowCountries(false);}} className={c.code===country.code?'active':''}>{c.name} <small>{c.dial}</small></button>)}</div>}
      {country.code==='OTHER'?<>
        <label>Country code<input value={otherDial} onChange={e=>setOtherDial(e.target.value.replace(/[^\d+]/g,'').slice(0,6))} placeholder="+1"/></label>
        <p className="nc-notice">For other countries you can pick a region and generate a local-style number, or continue with a generated number from that region.</p>
      </>:<label>Country code<input value={country.code==='ID'?'+62':dial} readOnly={country.code==='ID'} onChange={e=>setOtherDial(e.target.value)}/></label>}
      <button className="nc-primary" disabled={busy} onClick={()=>void getNumber()}><Phone size={16}/> {busy?'Generatingâ€¦':'Get number'}</button>
      {error&&<p role="alert" className="nc-error">{error}</p>}{notice&&<p role="status" className="nc-notice">{notice}</p>}
      <p style={{fontSize:12,color:'var(--muted)'}}>Numbers are virtual NearChat identifiers for finding contacts. You can share your username too.</p>
    </div></section></div></main>;

  return <main className="nc-auth"><header><Link href="/" className="nc-back"><ArrowLeft size={18}/> NearSpace</Link><span className="nc-wordmark"><MessageCircle/> NearChat</span></header><div className="nc-auth-grid"><section className="nc-auth-card"><span className="nc-kicker">YOUR PEOPLE, A LITTLE CLOSER</span><h1>{mode==='register'?'Make yourself at home.':mode==='forgot'?'Forgot your password?':mode==='reset'?'A fresh start.':'Good to see you.'}</h1><p>{mode==='register'?'Create your NearChat account, then get a number to register.':'Sign in to your conversations.'}</p>
    <form onSubmit={e=>{e.preventDefault();void submit();}}>{mode!=='reset'&&<label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}{mode!=='forgot'&&<label>Password<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={8} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
    {error&&<p role="alert" className="nc-error">{error}</p>}{notice&&<p role="status" className="nc-notice">{notice}</p>}<button className="nc-primary" disabled={busy}>{busy?'Please waitâ€¦':mode==='register'?'Create account':mode==='forgot'?'Send reset link':mode==='reset'?'Save password':'Sign in'}</button></form>
    <div className="nc-auth-links"><button onClick={()=>{setMode(mode==='register'?'login':'register');setError('');}}>{mode==='register'?'Already have an account? Sign in':'New here? Create account'}</button><button onClick={()=>setMode(mode==='forgot'?'login':'forgot')}>{mode==='forgot'?'Back to sign in':'Forgot password?'}</button></div></section>
    <section className="nc-link-card"><QrCode size={28}/><h2>Already signed in on your phone?</h2><p>Link this screen from NearChat on a device you trust.</p>{link ? <>{qr&&<img src={qr} width={220} height={220} alt="Scan to request desktop sign-in"/>}<strong className="nc-pair-code">{link.code.slice(0,3)}-{link.code.slice(3)}</strong><p>{now<link.expiresAt?`Expires in ${Math.ceil((link.expiresAt-now)/1000)} seconds`:'This code expired.'}</p><button onClick={()=>{setLink(null);setQr('');}}>New login code</button></> : <button className="nc-secondary" onClick={()=>{setError('');void chatApi<{id:string;code:string;expiresAt:number}>('/link',{name:'Linked computer'}).then(setLink).catch(cause=>setError(cause.message));}}>Show QR & pairing code</button>}<small><Mail size={14}/> New users need to register and verify their email first. On register you can choose a number (Indonesia +62 or other countries).</small></section></div></main>;
}
