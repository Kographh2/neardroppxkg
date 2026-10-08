'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole, Send, ShieldCheck } from 'lucide-react';
import { Modal } from './primitives';
import { usePlatform } from '@/lib/hooks';
import { api } from '@/lib/api';
import { binaryPreview, createVault, openMessage, sealMessage, unlockVault, wrapIdentity, type Vault } from '@/chat/crypto';
import type { ChatMessage } from '@/shared/chat';
import type { PublicKey } from '@/shared/protocol';

const vaultKey = (id: string) => `nd-chat-vault:${id}`;
function readVault(id: string): Vault | null { const raw = localStorage.getItem(vaultKey(id)); return raw ? JSON.parse(raw) as Vault : null; }
function saveVault(id: string, vault: Vault) { localStorage.setItem(vaultKey(id), JSON.stringify(vault)); }

function PrivateDialog({ mode, deviceId, message, onClose, onSaved }: { mode: 'setup' | 'read' | 'change'; deviceId: string; message?: ChatMessage; onClose(): void; onSaved(vault: Vault): void }) {
  const [code, setCode] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState('');
  const [text, setText] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const close = () => onClose(); const hidden = () => { if (document.hidden) close(); };
    window.addEventListener('blur', close); document.addEventListener('visibilitychange', hidden);
    const timeout = setTimeout(close, 60000);
    return () => { alive.current = false; clearTimeout(timeout); window.removeEventListener('blur', close); document.removeEventListener('visibilitychange', hidden); };
  }, [onClose]);
  async function submit() {
    setError(''); setBusy(true);
    try {
      if (mode === 'setup') {
        if (code !== confirm) throw new Error('The private codes do not match.');
        const existing = readVault(deviceId);
        const vault = existing || await createVault(code);
        if (existing) await unlockVault(existing, code);
        if (!alive.current) return;
        // Persist encrypted key before publishing it, so network retries cannot lose it.
        saveVault(deviceId, vault);
        await api('/chat/key', { publicKey: vault.publicKey });
        if (alive.current) { onSaved(vault); onClose(); }
      } else {
        const vault = readVault(deviceId); if (!vault) throw new Error('The private chat key is missing on this browser.');
        const identity = await unlockVault(vault, code);
        if (mode === 'read' && message) {
          const plaintext = await openMessage(identity, deviceId, message);
          if (alive.current) { setText(plaintext); setCode(''); }
        } else {
          if (next !== confirm) throw new Error('The new private codes do not match.');
          const replacement = await wrapIdentity(identity, next);
          if (alive.current) { saveVault(deviceId, replacement); onSaved(replacement); onClose(); }
        }
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not unlock this message.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Modal title={mode === 'setup' ? 'Set your private code' : mode === 'change' ? 'Change private code' : 'Private message'} onClose={onClose}>
    {text !== null ? <><div className="private-message">{text}</div><p className="chat-note">Close this window before replying. Opening a message again requires your code.</p><button className="button primary" onClick={onClose}>Close & lock</button></> :
      <form className="chat-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <p>Your code stays on this device. Store it in a safe, private place. If you lose the code or clear browser data, these messages cannot be recovered.</p>
        <label>{mode === 'change' ? 'Current private code' : 'Private code'}<input autoFocus type="password" autoComplete={mode === 'setup' ? 'new-password' : 'off'} value={code} onChange={e => setCode(e.target.value)} minLength={mode === 'setup' ? 12 : 1} maxLength={200} required/></label>
        {mode === 'change' && <label>New private code<input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} minLength={12} maxLength={200} required/></label>}
        {mode !== 'read' && <label>Confirm private code<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={12} maxLength={200} required/></label>}
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>{busy ? 'Securing…' : mode === 'read' ? 'Unlock message' : 'Save private code'}</button>
      </form>}
  </Modal>;
}

export function PrivateChat() {
  const state = usePlatform();
  const [peer, setPeer] = useState(''), [vault, setVault] = useState<Vault | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]), [peerKey, setPeerKey] = useState<PublicKey | null>(null);
  const [draft, setDraft] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'setup' | 'read' | 'change'; message?: ChatMessage } | null>(null);
  const [notice, setNotice] = useState('');
  const closeDialog = useCallback(() => setDialog(null), []);
  const latest = useRef(new Set<string>());
  const deviceId = state.device?.id;
  useEffect(() => { if (!peer && state.devices.length) setPeer(state.devices[0].id); }, [peer, state.devices]);
  useEffect(() => { if (deviceId) { try { setVault(readVault(deviceId)); } catch { setError('Private storage is unavailable. Enable browser storage to use private chat.'); } } }, [deviceId]);
  useEffect(() => {
    setMessages([]); setPeerKey(null); latest.current.clear();
    if (!peer || state.status !== 'online') return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<{ messages: ChatMessage[]; peerKey: PublicKey | null }>(`/chat/messages?peer=${encodeURIComponent(peer)}`);
        if (stopped) return;
        if (result.messages.some(m => m.receiverId === deviceId && !latest.current.has(m.id))) setNotice('A private message is waiting. Select its binary card to unlock.');
        latest.current = new Set(result.messages.map(m => m.id)); setMessages(result.messages); setPeerKey(result.peerKey); setError('');
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : 'Could not refresh messages.'); }
      if (!stopped) timer = setTimeout(() => void poll(), 4000);
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [peer, state.status, deviceId]);
  async function send() {
    if (!vault || !deviceId || !peerKey) return;
    setBusy(true); setError('');
    try {
      const identity = await unlockVault(vault, code);
      const envelope = await sealMessage(identity, deviceId, peer, peerKey, draft);
      const result = await api<{ message: ChatMessage }>('/chat/messages', envelope);
      setMessages(items => [...items.filter(m => m.id !== result.message.id), result.message]); setDraft(''); setCode('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Message was not sent. Try again.'); }
    finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">ONLY FOR YOUR EYES</span><h1>Private chat.</h1><p>Encrypted between paired devices. Open a message with your private code.</p></div></div>
    <section className="surface chat-panel">
      <div className="chat-toolbar"><ShieldCheck size={22}/><label>Chat with<select value={peer} onChange={e => { setPeer(e.target.value); setDraft(''); setCode(''); setNotice(''); }}>{state.devices.map(d => <option key={d.id} value={d.id}>{d.name}{d.online ? '' : ' · offline'}</option>)}</select></label>
        <button className="button secondary-button small" disabled={!deviceId} onClick={() => setDialog({ mode: vault ? 'change' : 'setup' })}>{vault ? 'Change private code' : 'Set private code'}</button></div>
      {!state.devices.length && <p>Connect another device to start a conversation. <Link href="/connect">Connect a device</Link></p>}
      {notice && <p role="status" className="chat-note">{notice}</p>}
      <div className="chat-messages" aria-label="Encrypted messages">{messages.length ? messages.map(message => <button key={message.id} className={`cipher-message ${message.senderId === deviceId ? 'outgoing' : ''}`} aria-label={`Unlock ${message.senderId === deviceId ? 'sent' : 'received'} message at ${new Date(message.createdAt).toLocaleTimeString()}`} onClick={() => { setNotice(''); setDialog({ mode: vault ? 'read' : 'setup', message }); }}>
        <span><LockKeyhole size={14}/>{message.senderId === deviceId ? 'You' : state.devices.find(d => d.id === peer)?.name}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
        <code>{binaryPreview(message.ciphertext)}</code><small>Tap to unlock</small></button>) : <div className="chat-empty"><LockKeyhole size={30}/><h2>A little more private.</h2><p>Your conversation will appear as encrypted binary. Only the private window reveals the words.</p></div>}</div>
      {error && <p role="alert">{error}</p>}
      <form className="chat-form chat-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label>Message<textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={4000} placeholder="Write privately…" required disabled={!vault || !peerKey}/></label>
        <div><label>Private code to send<input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} maxLength={200} required disabled={!vault || !peerKey}/></label><button className="button primary" disabled={busy || !vault || !peerKey || state.status !== 'online'}><Send size={16}/>{busy ? 'Encrypting…' : 'Send privately'}</button></div>
        <p className="chat-note">{!vault ? 'Set your private code first.' : !peerKey ? 'The other device needs to set a private code too.' : 'Your devices use separate private codes. Never share yours.'} Encrypted messages expire after 7 days. The latest 100 appear here.</p>
      </form>
    </section>
    {dialog && deviceId && <PrivateDialog key={`${dialog.mode}:${dialog.message?.id}`} {...dialog} deviceId={deviceId} onSaved={setVault} onClose={closeDialog}/>}
  </>;
}
