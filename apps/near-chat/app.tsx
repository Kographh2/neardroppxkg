'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, Link2, LogOut, MessageCircle, MonitorSmartphone, Plus, Search, Send, Settings2, Users, X } from 'lucide-react';
import { authClient } from '@/lib/auth';
import { Modal } from '@/components/primitives';
import { ThemeButton } from '@/components/theme-button';
import { AuthScreen } from './auth-screen';
import { DevicesDialog, LinkDevice, NewConversation, ProfileDialog } from './dialogs';
import { chatApi, ChatApiError } from './client-api';
import type { Message, Profile, Room } from './shared';

function title(room:Room,self:string) { return room.kind==='group'?room.name:room.members.find(m=>m.id!==self)?.displayName||'Conversation'; }
function Avatar({name,group=false}:{name:string;group?:boolean}) { return <span className={`nc-avatar ${group?'group':''}`}>{group?<Users size={20}/>:name.trim().slice(0,2).toUpperCase()}</span>; }
const merge=(items:Message[],incoming:Message[])=>[...new Map([...items,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
export function NearChatApp() {
  const params=useSearchParams(),router=useRouter();
  const [profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [rooms,setRooms]=useState<Room[]>([]),[active,setActive]=useState(''),[query,setQuery]=useState('');
  const [messages,setMessages]=useState<Message[]>([]),[more,setMore]=useState(false),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[loadingMessages,setLoadingMessages]=useState(false);
  const [dialog,setDialog]=useState<'new'|'profile'|'link'|'devices'|'info'|'leave'|null>(null);
  const scroller=useRef<HTMLDivElement>(null),bottom=useRef<HTMLDivElement>(null),activeRef=useRef(active),readRef=useRef(0);
  const historyExhausted=useRef(false);
  const pending=useRef<{id:string;body:string;roomId:string}|null>(null);
  activeRef.current=active;
  const reload=useCallback(async()=>{setLoading(true);try{const r=await chatApi<{profile:Profile}>('/me');setProfile(r.profile);setError('');if(r.profile.displayName==='New member')setDialog('profile');}catch(cause){if(!(cause instanceof ChatApiError&&cause.status===401))setError(cause instanceof Error?cause.message:'Could not connect.');setProfile(null);}finally{setLoading(false);}},[]);
  const loggedIn=useCallback(()=>{if(params.get('recovery'))router.replace('/near-chat');void reload();},[params,router,reload]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{if(profile&&params.get('link'))setDialog('link');},[profile,params]);
  const fail=useCallback((cause:unknown)=>{if(cause instanceof ChatApiError&&cause.status===401){setProfile(null);setMessages([]);setRooms([]);}setError(cause instanceof Error?cause.message:'Could not reach NearChat.');},[]);
  const refreshRooms=useCallback(async()=>{const r=await chatApi<{rooms:Room[]}>('/rooms');setRooms(r.rooms);},[]);
  useEffect(()=>{
    if(!profile)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const r=await chatApi<{rooms:Room[]}>('/rooms');if(!cancelled){setRooms(r.rooms);if(activeRef.current&&!r.rooms.some(room=>room.id===activeRef.current))setActive('');}}catch(cause){if(!cancelled)fail(cause);}if(!cancelled)timer=setTimeout(()=>void poll(),document.hidden?15000:4000);}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[profile,fail]);
  useEffect(()=>{
    setMessages([]);setMore(false);setDraft('');pending.current=null;readRef.current=0;historyExhausted.current=false;
    if(!active||!profile)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;setLoadingMessages(true);
    async function poll(){try{
      const r=await chatApi<{messages:Message[];hasMore:boolean}>(`/rooms/${active}/messages`);
      if(cancelled)return;const nearBottom=!scroller.current||scroller.current.scrollHeight-scroller.current.scrollTop-scroller.current.clientHeight<100;
      setMessages(items=>merge(items,r.messages));setMore(!historyExhausted.current&&r.hasMore);setError('');setLoadingMessages(false);
      if(nearBottom)requestAnimationFrame(()=>bottom.current?.scrollIntoView({block:'nearest'}));
      const last=r.messages.at(-1)?.sequence||0;
      if(!document.hidden&&last>readRef.current){await chatApi(`/rooms/${active}/read`,{sequence:last});readRef.current=last;}
    }catch(cause){if(!cancelled){setLoadingMessages(false);fail(cause);}}if(!cancelled)timer=setTimeout(()=>void poll(),document.hidden?15000:2200);}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[active,profile,fail]);
  async function send(){if(!active||!draft.trim()||sending)return;setSending(true);setError('');const roomId=active;
    const value=pending.current?.body===draft.trim()&&pending.current.roomId===active?pending.current:{id:crypto.randomUUID(),body:draft.trim(),roomId};pending.current=value;
    try{await chatApi(`/rooms/${roomId}/messages`,{id:value.id,body:value.body});if(activeRef.current===roomId){setDraft('');pending.current=null;const r=await chatApi<{messages:Message[]}>(`/rooms/${roomId}/messages`);if(activeRef.current===roomId){setMessages(items=>merge(items,r.messages));requestAnimationFrame(()=>bottom.current?.scrollIntoView({block:'nearest'}));}}await refreshRooms();}catch(cause){fail(cause);}finally{setSending(false);}}
  async function older(){const first=messages[0];if(!first)return;try{const r=await chatApi<{messages:Message[];hasMore:boolean}>(`/rooms/${active}/messages?before=${first.sequence}`);if(activeRef.current!==first.roomId)return;setMessages(items=>merge(r.messages,items));historyExhausted.current=!r.hasMore;setMore(r.hasMore);}catch(cause){fail(cause);}}
  async function signOut(){try{await chatApi('/sign-out',{});await authClient()?.auth.signOut({scope:'local'});setProfile(null);setRooms([]);setMessages([]);setActive('');setDialog(null);}catch(cause){fail(cause);}}
  function closeDialog(){setDialog(null);if(params.get('link'))router.replace('/near-chat');}
  if(loading)return <main className="nc-loading"><MessageCircle size={30}/><p>Opening NearChat…</p></main>;
  if(!profile||params.get('recovery'))return <><AuthScreen onLogin={loggedIn} recovery={!!params.get('recovery')}/>{error&&<div className="nc-global-error" role="alert">{error}<button onClick={()=>void reload()}>Try again</button></div>}</>;
  const room=rooms.find(r=>r.id===active);
  return <div className={`nc-shell ${active?'conversation-open':''}`}>
    <aside className="nc-sidebar"><header><Link href="/" className="nc-home" aria-label="Back to NearSpace"><ArrowUpRight size={18}/></Link><span className="nc-wordmark"><MessageCircle/> NearChat</span><ThemeButton/></header><div className="nc-sidebar-title"><h1>Chats<span>{rooms.length}</span></h1><button className="nc-icon" aria-label="New conversation" onClick={()=>setDialog('new')}><Plus size={22}/></button></div>
    <label className="nc-search"><Search size={17}/><input aria-label="Search conversations" placeholder="Find a conversation" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <nav className="nc-conversations" aria-label="Conversations">{rooms.filter(r=>title(r,profile.id).toLowerCase().includes(query.toLowerCase())).map(r=><button key={r.id} className={r.id===active?'active':''} onClick={()=>{setActive(r.id);setError('');}}><Avatar name={title(r,profile.id)} group={r.kind==='group'}/><span><strong>{title(r,profile.id)}</strong><small>{r.kind==='group'?`${r.members.length} members`:'Private conversation'}</small></span><div><time>{new Date(r.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{r.unread>0&&<b>{r.unread}</b>}</div></button>)}{!rooms.length&&<div className="nc-list-empty"><MessageCircle size={26}/><p>Your people will be here.</p><button onClick={()=>setDialog('new')}>Start your first chat</button></div>}</nav>
    <footer><button className="nc-profile" onClick={()=>setDialog('profile')}><Avatar name={profile.displayName}/><span><strong>{profile.displayName}</strong><small>@{profile.username}</small></span><Settings2 size={17}/></button><div className="nc-shortcuts"><button onClick={()=>setDialog('link')}><Link2 size={17}/> Link device</button><button onClick={()=>setDialog('devices')}><MonitorSmartphone size={17}/> Devices</button><button onClick={()=>void signOut()} aria-label="Sign out"><LogOut size={17}/></button></div></footer></aside>
    <main className="nc-conversation" id="main-content">{room?<><header><button className="nc-icon nc-mobile-back" aria-label="Back to chats" onClick={()=>setActive('')}><ArrowLeft/></button><Avatar name={title(room,profile.id)} group={room.kind==='group'}/><button className="nc-room-title" onClick={()=>setDialog('info')}><strong>{title(room,profile.id)}</strong><span>{room.kind==='group'?`${room.members.length} people · Group details`:'Conversation details'}</span></button></header>
      {error&&<div className="nc-error-bar" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      <div className="nc-message-list" ref={scroller}>{more&&<button className="nc-load-more" onClick={()=>void older()}>Load older messages</button>}{loadingMessages&&<p className="nc-date">Loading conversation…</p>}{!loadingMessages&&!messages.length&&<div className="nc-chat-empty"><h2>Say something good.</h2><p>Send the first message in this conversation.</p></div>}
      {messages.map((m,index)=><div key={m.id}>{(index===0||new Date(messages[index-1].createdAt).toDateString()!==new Date(m.createdAt).toDateString())&&<p className="nc-date">{new Date(m.createdAt).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'})}</p>}<article className={`nc-bubble ${m.senderId===profile.id?'own':''}`}>{room.kind==='group'&&m.senderId!==profile.id&&<strong>{m.senderName}</strong>}<p>{m.body}</p><footer><time>{new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{m.senderId===profile.id&&<span title="Stored on the server"><Check size={13}/> Sent</span>}</footer></article></div>)}<div ref={bottom}/></div>
      <form className="nc-composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="Message" placeholder="Write a message…" value={draft} maxLength={4000} rows={1} disabled={sending} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><button aria-label="Send message" className="nc-send" disabled={!draft.trim()||sending}><Send size={20}/></button></form>
    </>:<div className="nc-welcome"><span><MessageCircle size={45}/></span><h2>A little closer.</h2><p>Choose a conversation, or start a new one.</p><button className="nc-primary" onClick={()=>setDialog('new')}><Plus size={17}/> New conversation</button><small>Account-protected rooms. Messages are not end-to-end encrypted.</small></div>}</main>
    {dialog==='new'&&<NewConversation onClose={closeDialog} onCreated={id=>{void refreshRooms().then(()=>{setActive(id);setDialog(null);}).catch(fail);}}/>}
    {dialog==='profile'&&<ProfileDialog profile={profile} onClose={closeDialog} onSaved={value=>{setProfile(value);setDialog(null);}}/>}
    {dialog==='link'&&<LinkDevice initialCode={params.get('link')||''} onClose={closeDialog}/>}
    {dialog==='devices'&&<DevicesDialog onClose={closeDialog}/>}
    {dialog==='info'&&room&&<Modal title="Conversation details" onClose={closeDialog}><div className="nc-form"><h3>{title(room,profile.id)}</h3>{room.members.map(m=><div className="nc-session" key={m.id}><Avatar name={m.displayName}/><span><strong>{m.displayName}</strong><small>@{m.username}</small></span></div>)}<p>Only members can access this room. Messages are stored on the server and protected by account authorization and HTTPS. This version does not use end-to-end encryption.</p>{room.kind==='group'&&<button className="nc-secondary" onClick={()=>setDialog('leave')}>{room.ownerId===profile.id?'Delete group':'Leave group'}</button>}</div></Modal>}
    {dialog==='leave'&&room&&<Modal title={room.ownerId===profile.id?'Delete this group?':'Leave this group?'} onClose={closeDialog}><div className="nc-form"><p>{room.ownerId===profile.id?'This permanently deletes the group and its messages for all members.':'You will lose access to this conversation.'}</p><button className="nc-primary" onClick={()=>void chatApi(`/rooms/${room.id}/leave`,{}).then(()=>{setActive('');setDialog(null);void refreshRooms();}).catch(fail)}>Confirm</button><button className="nc-secondary" onClick={closeDialog}>Cancel</button></div></Modal>}
  </div>;
}
