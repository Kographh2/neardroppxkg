'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/primitives';
import { chatApi } from './client-api';
import type { Contact, LinkedSession, Profile, StatusItem } from './shared';

export function NewConversation({ onClose,onCreated,contacts=[] }: {onClose():void;onCreated(id:string):void;contacts?:Contact[]}) {
 const [group,setGroup]=useState(false),[names,setNames]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <Modal title="Start a conversation" onClose={onClose}><form className="nc-form" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void chatApi<{id:string}>('/rooms',{kind:group?'group':'direct',name,members:names.split(',').map(s=>s.trim()).filter(Boolean)}).then(r=>onCreated(r.id)).catch(cause=>setError(cause.message)).finally(()=>setBusy(false));}}><label className="nc-check"><input type="checkbox" checked={group} onChange={e=>setGroup(e.target.checked)}/> Create a group</label>{group&&<label>Group name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}<label>{group?'Usernames/numbers, separated by commas':'Username or number'}<input autoFocus required value={names} onChange={e=>setNames(e.target.value)} placeholder={group?'alex, +62812..., riley':'alex or +62812...'} maxLength={750}/></label>{contacts.length>0&&<div className="nc-pick-list">{contacts.slice(0,8).map(c=><button type="button" key={c.id} onClick={()=>setNames(n=>group?(n? n+', '+c.username:c.username):c.username)}><strong>{c.displayName}</strong><small>@{c.username}{c.phone?` · ${c.phone}`:''}</small></button>)}</div>}<p>Ask your friend for their exact NearChat username or number.</p>{error&&<p role="alert" className="nc-error">{error}</p>}<button className="nc-primary" disabled={busy}>{busy?'Creating…':'Start chat'}</button></form></Modal>;
}
export function AddContactDialog({onClose,onAdded}:{onClose():void;onAdded(c:Contact):void}){
 const [value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <Modal title="Add contact" onClose={onClose}><form className="nc-form" onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void chatApi<{contact:Contact}>('/contacts',{value}).then(r=>onAdded(r.contact)).catch(cause=>setError(cause.message)).finally(()=>setBusy(false));}}><label>Username or phone number<input autoFocus required value={value} onChange={e=>setValue(e.target.value)} placeholder="@username or +628123..." maxLength={32}/></label><p>Add by exact username or NearChat number.</p>{error&&<p role="alert" className="nc-error">{error}</p>}<button className="nc-primary" disabled={busy}>{busy?'Adding…':'Add contact'}</button></form></Modal>;
}
export function ProfileDialog({profile,onClose,onSaved}:{profile:Profile;onClose():void;onSaved(profile:Profile):void}) {
 const [name,setName]=useState(profile.displayName),[username,setUsername]=useState(profile.username),[about,setAbout]=useState(profile.about||'Hey there! I am using NearChat.'),[avatar,setAvatar]=useState<string|null>(profile.avatar||null),[readReceipts,setReadReceipts]=useState(profile.readReceipts!==false),[error,setError]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 function pick(e:React.ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{const img=new Image(); img.onload=()=>{const c=document.createElement('canvas'); const s=Math.min(256/img.width,256/img.height,1); c.width=Math.max(1,Math.round(img.width*s)); c.height=Math.max(1,Math.round(img.height*s)); c.getContext('2d')?.drawImage(img,0,0,c.width,c.height); setAvatar(c.toDataURL('image/jpeg',0.82));}; img.src=String(r.result||'');}; r.readAsDataURL(f);}
 return <Modal title="Your NearChat profile" onClose={onClose}><form className="nc-form" onSubmit={e=>{e.preventDefault();void chatApi<{profile:Profile}>('/me',{displayName:name,username,about,avatar,readReceipts},'PATCH').then(r=>onSaved(r.profile)).catch(cause=>setError(cause.message));}}>
  <div className="nc-avatar-edit" onClick={()=>fileRef.current?.click()}>{avatar?<img src={avatar} alt=""/>:<span>{name.trim().slice(0,2).toUpperCase()}</span>}<small>Change photo</small></div><input ref={fileRef} type="file" accept="image/*" hidden onChange={pick}/>
  <label>Display name<input required value={name} maxLength={48} onChange={e=>setName(e.target.value)}/></label>
  <label>Username<input required pattern="[a-z][a-z0-9_]{2,23}" minLength={3} maxLength={24} value={username} onChange={e=>setUsername(e.target.value.toLowerCase())}/></label>
  <label>About<input value={about} maxLength={140} onChange={e=>setAbout(e.target.value)}/></label>
  {profile.phone&&<label>Number<input value={profile.phone} readOnly/></label>}
  <label className="nc-check"><input type="checkbox" checked={readReceipts} onChange={e=>setReadReceipts(e.target.checked)}/> Blue read receipts (centang dua biru)</label>
  <p>3–24 characters. Start with a letter; use letters, numbers and underscores. Share username or number so friends can find you.</p>
  {avatar&&<button type="button" className="nc-secondary" onClick={()=>setAvatar(null)}>Remove photo</button>}
  {error&&<p role="alert" className="nc-error">{error}</p>}<button className="nc-primary">Save profile</button></form></Modal>;
}
export function StatusDialog({onClose,onSaved}:{onClose():void;onSaved():void}){
 const [kind,setKind]=useState<'text'|'image'>('text'),[body,setBody]=useState(''),[caption,setCaption]=useState(''),[bg,setBg]=useState('#177d69'),[error,setError]=useState('');
 function pick(e:React.ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{const img=new Image(); img.onload=()=>{const c=document.createElement('canvas'); const s=Math.min(1080/img.width,1080/img.height,1); c.width=Math.max(1,Math.round(img.width*s)); c.height=Math.max(1,Math.round(img.height*s)); c.getContext('2d')?.drawImage(img,0,0,c.width,c.height); setBody(c.toDataURL('image/jpeg',0.85)); setKind('image');}; img.src=String(r.result||'');}; r.readAsDataURL(f);}
 return <Modal title="Add status" onClose={onClose}><form className="nc-form" onSubmit={e=>{e.preventDefault();setError('');void chatApi('/statuses',{kind,body,caption,bg}).then(()=>onSaved()).catch(cause=>setError(cause.message));}}>
  <label className="nc-check"><input type="checkbox" checked={kind==='image'} onChange={e=>setKind(e.target.checked?'image':'text')}/> Image status</label>
  {kind==='image'?<><input type="file" accept="image/*" onChange={pick}/>{body&&<img src={body} alt="" style={{maxWidth:'100%',borderRadius:12}}/>}<label>Caption<input value={caption} maxLength={300} onChange={e=>setCaption(e.target.value)}/></label></>:<><label>Status text<textarea value={body} maxLength={400} onChange={e=>setBody(e.target.value)} rows={4} required/></label><label>Background<input type="color" value={bg} onChange={e=>setBg(e.target.value)}/></label></>}
  {error&&<p role="alert" className="nc-error">{error}</p>}<button className="nc-primary" disabled={!body.trim()}>Post status</button></form></Modal>;
}
export function StatusViewer({statuses,onClose,onDelete}:{statuses:StatusItem[];onClose():void;onDelete(id:string):void}){
 const [i,setI]=useState(0); const s=statuses[i]; if(!s) return null;
 return <Modal title={`${s.displayName}'s status`} onClose={onClose}><div className="nc-form" style={{alignItems:'center'}}>
  {s.kind==='image'?<div style={{width:'100%'}}><img src={s.body} alt="" style={{width:'100%',borderRadius:12}}/>{s.caption&&<p>{s.caption}</p>}</div>:<div style={{width:'100%',minHeight:220,borderRadius:12,background:s.bg||'#177d69',color:'#fff',display:'grid',placeItems:'center',padding:20,fontSize:22,textAlign:'center'}}>{s.body}</div>}
  <small>{new Date(s.createdAt).toLocaleString()}</small>
  <div style={{display:'flex',gap:8}}><button className="nc-secondary" disabled={i===0} onClick={()=>setI(i-1)}>Prev</button><button className="nc-secondary" disabled={i>=statuses.length-1} onClick={()=>setI(i+1)}>Next</button>{s.mine&&<button className="nc-secondary" onClick={()=>onDelete(s.id)}>Delete</button>}</div>
 </div></Modal>;
}
export function LinkDevice({initialCode='',onClose}:{initialCode?:string;onClose():void}) {
 const [code,setCode]=useState(initialCode),[name,setName]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false),[busy,setBusy]=useState(false);
 async function submit(approve:boolean){setBusy(true);setError('');try{const r=await chatApi<{name:string}>('/link/approve',{code,approve});setName(r.name);if(approve)setDone(true);}catch(cause){setError(cause instanceof Error?cause.message:'Could not link this device.');}finally{setBusy(false);}}
 return <Modal title="Link a device" onClose={onClose}>{done?<div className="nc-form"><h3>Device linked.</h3><p>Manage or revoke access from Linked devices.</p><button className="nc-primary" onClick={onClose}>Done</button></div>:<form className="nc-form" onSubmit={e=>{e.preventDefault();void submit(!!name);}}>{!name?<><label>Desktop pairing code<input autoFocus required value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC-234"/></label><p>Or scan the desktop QR with your phone camera and open its NearChat link.</p></>:<><h3>Sign in on {name}?</h3><p>This device will get access to your NearChat conversations. Approve only a screen you opened yourself.</p></>}{error&&<p role="alert" className="nc-error">{error}</p>}<button className="nc-primary" disabled={busy}>{busy?'Please wait…':name?'Approve sign-in':'Check device'}</button></form>}</Modal>;
}
export function DevicesDialog({onClose}:{onClose():void}) {
 const [sessions,setSessions]=useState<LinkedSession[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;void chatApi<{sessions:LinkedSession[]}>('/sessions').then(r=>{if(!cancelled)setSessions(r.sessions);}).catch(cause=>{if(!cancelled)setError(cause.message);});return()=>{cancelled=true;};},[]);
 return <Modal title="Linked devices" onClose={onClose}><div className="nc-form">{sessions?.map(s=><div className="nc-session" key={s.id}><div><strong>{s.name}{s.current?' · This device':''}</strong><small>Linked {new Date(s.createdAt).toLocaleDateString()}</small></div>{!s.current&&<button className="nc-secondary" onClick={()=>void chatApi(`/sessions/${s.id}`,{},'DELETE').then(()=>setSessions(items=>items!.filter(x=>x.id!==s.id))).catch(cause=>setError(cause.message))}>Revoke</button>}</div>)}{!sessions&&<p>Loading linked devices…</p>}{error&&<p role="alert" className="nc-error">{error}</p>}<p>Revoking a device signs it out on its next request. Your current session expires after 30 days.</p></div></Modal>;
}
