'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Check, Copy, KeyRound, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { platform } from '@/lib/platform-client';
import { capabilities } from '@/transfer/capabilities';
import { usePlatform } from '@/lib/hooks';
import { copyText } from '@/lib/clipboard';
import { Spinner } from './primitives';
export function PairingPanel({ mode: initialMode = 'qr', onPaired }: { mode?: 'qr' | 'code' | 'scan'; onPaired?: () => void }) {
  const state = usePlatform(); const code = state.pairing;
  const [mode, setMode] = useState(initialMode);
  const [qr, setQr] = useState(''); const [now, setNow] = useState(Date.now()); const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [waiting, setWaiting] = useState(''); const [copied, setCopied] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'requesting' | 'active' | 'unavailable'>('requesting');
  const video = useRef<HTMLVideoElement>(null);
  const openedRevision = useRef(state.pairingRevision);
  useEffect(() => { if (state.pairingRevision !== openedRevision.current) onPaired?.(); }, [state.pairingRevision, onPaired]);
  async function refresh(force = true) {
    setBusy(true); setError('');
    try { await platform.refreshPairing(force); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { if (state.status === 'online') void refresh(false); }, [state.status]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!code) return; const url = new URL('/connect', location.origin); url.hash = `code=${code.code}`; let current = true; void QRCode.toDataURL(url.href, { width: 320, margin: 1, color: { dark: '#182942', light: '#ffffff' }, errorCorrectionLevel: 'M' }).then(value => { if (current) setQr(value); }).catch(() => setError('Could not generate QR. Use the pairing code instead.')); return () => { current = false; }; }, [code]);
  useEffect(() => {
    const hashCode = new URLSearchParams(location.hash.slice(1)).get('code');
    if (hashCode) { setInput(hashCode); setMode('code'); history.replaceState(null, '', location.pathname); }
  }, []);
  async function join(value = input) { setBusy(true); setError(''); try { const result = await platform.pair(value); setWaiting(result.device.name); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }
  useEffect(() => {
    if (mode !== 'scan') return;
    let stopped = false; let stop: (() => void) | undefined;
    if (!capabilities().camera) { setCameraStatus('unavailable'); setError('Camera access is unavailable. Enter the pairing code instead.'); return; }
    setError(''); setCameraStatus('requesting');
    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video.current!, (result, _error, controls) => {
        if (!result || stopped) return;
        try { const url = new URL(result.getText()); const found = new URLSearchParams(url.hash.slice(1)).get('code'); if (url.origin !== location.origin || url.pathname !== '/connect' || !found || !/^[A-HJ-NP-Z2-9]{6}$/.test(found)) throw new Error(); stopped = true; controls.stop(); setInput(found); setMode('code'); void join(found); } catch { setError('This is not a NearDrop QR code for this server.'); }
      });
      stop = () => controls.stop(); if (stopped) stop(); else setCameraStatus('active');
    }).catch(() => { if (!stopped) { setCameraStatus('unavailable'); setError('Camera permission was denied or the camera is unavailable. Enter the code instead.'); } });
    return () => { stopped = true; stop?.(); };
  }, [mode]);
  const seconds = Math.max(0, Math.ceil(((code?.expiresAt || now) - now) / 1000));
  return <div className="pairing-panel"><div className="segmented pairing-tabs"><button className={mode === 'qr' ? 'active' : ''} onClick={() => setMode('qr')}><ScanLine size={16}/> Show QR</button><button className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}><KeyRound size={16}/> Enter code</button><button className={mode === 'scan' ? 'active' : ''} onClick={() => setMode('scan')}><Camera size={16}/> Scan</button></div>
    {waiting ? <div className="pairing-wait"><span className="connection-orbit"><Spinner/></span><h3>Connecting to {waiting}</h3><p>Confirm the request on your other device.</p><button className="text-button" onClick={() => setWaiting('')}>Enter another code</button></div> : mode === 'qr' ? <><div className="qr-frame">{qr && seconds > 0 ? <img src={qr} width="200" height="200" alt="Scan to pair this device with NearDrop"/> : <div className="qr-placeholder">{busy ? <Spinner/> : <><RefreshCw size={25}/><span>Code expired</span><button className="text-button" onClick={() => void refresh()}>Generate a new code</button></>}</div>}</div><p className="pair-instruction">Scan with NearDrop on your other device</p><div className="pairing-code-row"><span className="eyebrow">OR ENTER THIS CODE</span><div className="pairing-code"><strong>{code ? `${code.code.slice(0,4)}-${code.code.slice(4)}` : '••••-••'}</strong><button className="icon-button" aria-label="Copy pairing code" disabled={!code} onClick={() => { if (code) void copyText(code.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setError('Select the code and copy it manually.')); }}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div></div><div className="code-footer"><span>Expires in <span className="tabular">{Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</span></span><button className="text-button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={13} className={busy ? 'spin' : ''}/> Refresh</button></div></> : mode === 'code' ? <form className="code-form" onSubmit={event => { event.preventDefault(); void join(); }}><div className="feature-icon"><KeyRound size={24}/></div><h3>One code. Two connected devices.</h3><p>Enter the pairing code shown on your other device.</p><label className="sr-only" htmlFor="pairing-input">Pairing code</label><input id="pairing-input" className="code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="N7K4-P2" maxLength={9} value={input} onChange={e => setInput(e.target.value.toUpperCase())}/><button className="button primary" disabled={busy || input.replace(/[-\s]/g,'').length !== 6}>{busy ? <Spinner/> : null} Connect device</button></form> : <div className="scanner"><video ref={video} autoPlay muted playsInline/><span className="scanner-frame"/><p role="status">{cameraStatus === 'requesting' ? 'Requesting camera access…' : cameraStatus === 'active' ? 'Point your camera at a NearDrop QR code.' : 'Camera unavailable. Use a pairing code instead.'}</p><button className="text-button" onClick={() => setMode('code')}>Enter pairing code instead</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="pairing-security"><ShieldCheck size={15}/> Only connect devices you recognize.</div></div>;
}
