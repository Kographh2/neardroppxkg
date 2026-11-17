'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Camera, Check, CheckCheck, Copy, Forward, Image as ImageIcon, Link2, LogOut, MessageCircle, MonitorSmartphone, Phone, PhoneIncoming, PhoneOff, Plus, Reply, Search, Send, Settings2, Smile, Trash2, UserPlus, Users, X } from 'lucide-react';
import { authClient } from '@/lib/auth';
import { Modal } from '@/components/primitives';
import { ThemeButton } from '@/components/theme-button';
import { AuthScreen } from './auth-screen';
import { AddContactDialog, DevicesDialog, LinkDevice, NewConversation, ProfileDialog, StatusDialog, StatusViewer } from './dialogs';
import { chatApi, ChatApiError } from './client-api';
import type { CallState, Contact, Message, Profile, Room, StatusItem } from './shared';

function title(room:Room,self:string) { return room.kind==='group'?room.name:room.members.find(m=>m.id!==self)?.displayName||'Conversation'; }
function Avatar({name,avatar,group=false,size=43}:{name:string;avatar?:string|null;group?:boolean;size?:number}) {
  if(avatar) return <img src={avatar} alt="" className={`nc-avatar-img ${group?'group':''}`} style={{width:size,height:size,borderRadius:Math.round(size*0.36),objectFit:'cover',flexShrink:0}}/>;
  return <span className={`nc-avatar ${group?'group':''}`} style={{width:size,height:size,borderRadius:Math.round(size*0.36)}}>{group?<Users size={Math.round(size*0.45)}/>:name.trim().slice(0,2).toUpperCase()}</span>;
}
const merge=(items:Message[],incoming:Message[])=>[...new Map([...items,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
function linkify(text:string){ const re=/((https?:\/\/|www\.)[^\s]+)/g; const parts=text.split(re); return parts.map((p,i)=>{ if(/^(https?:\/\/|www\.)/.test(p)){const href=p.startsWith('http')?p:`https://${p}`; return <a key={i} href={href} target="_blank" rel="noreferrer" className="nc-link">{p}</a>} return <span key={i}>{p}</span>; }); }
function MessageBody({m,reply}:{m:Message;reply?:Message|null}){
  if(m.deleted) return <p className="nc-deleted">This message was deleted</p>;
  return <>
    {reply&&<div className="nc-reply-preview"><strong>{reply.senderName}</strong><span>{reply.deleted?'Deleted':(reply.kind==='image'?'Photo':reply.body.slice(0,80))}</span></div>}
    {m.forwarded&&<div className="nc-forwarded"><Forward size={12}/> Forwarded</div>}
    {m.kind==='image'&&m.attachment&&<img src={m.attachment} alt={m.body||'image'} className="nc-msg-image"/>}
    {m.kind==='call'&&<p><Phone size={14}/> {m.body||'Call'}</p>}
    {m.body&&m.kind!=='call'&&<p>{linkify(m.body)}</p>}
  </>;
}

export function NearChatApp() {
  const params=useSearchParams(),router=useRouter();
  const [profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [rooms,setRooms]=useState<Room[]>([]),[active,setActive]=useState(''),[query,setQuery]=useState('');
  const [messages,setMessages]=useState<Message[]>([]),[more,setMore]=useState(false),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[loadingMessages,setLoadingMessages]=useState(false);
  const [dialog,setDialog]=useState<'new'|'profile'|'link'|'devices'|'info'|'leave'|'contact'|'status'|null>(null);
  const [contacts,setContacts]=useState<Contact[]>([]),[statuses,setStatuses]=useState<StatusItem[]>([]),[viewStatus,setViewStatus]=useState<StatusItem[]|null>(null);
  const [menu,setMenu]=useState<{x:number;y:number;message:Message}|null>(null),[replyTo,setReplyTo]=useState<Message|null>(null),[forward,setForward]=useState<Message|null>(null);
  const [tab,setTab]=useState<'chats'|'status'|'calls'>('chats');
  const [call,setCall]=useState<CallState|null>(null),[callState,setCallState]=useState<'idle'|'calling'|'incoming'|'active'>('idle');
  const pc=useRef<RTCPeerConnection|null>(null),localStream=useRef<MediaStream|null>(null),remoteAudio=useRef<HTMLAudioElement|null>(null),seenIce=useRef<Set<string>>(new Set()),handledCalls=useRef<Set<string>>(new Set());
  const scroller=useRef<HTMLDivElement>(null),bottom=useRef<HTMLDivElement>(null),activeRef=useRef(active),readRef=useRef(0),profileRef=useRef(profile);
  const historyExhausted=useRef(false),pending=useRef<{id:string;roomId:string}|null>(null),pressTimer=useRef<any>(null),fileRef=useRef<HTMLInputElement>(null);
  activeRef.current=active; profileRef.current=profile;

  const reload=useCallback(async()=>{setLoading(true);try{const r=await chatApi<{profile:Profile}>('/me');setProfile(r.profile);setError('');if(r.profile.displayName==='New member')setDialog('profile');}catch(cause){if(!(cause instanceof ChatApiError&&cause.status===401))setError(cause instanceof Error?cause.message:'Could not connect.');setProfile(null);}finally{setLoading(false);}},[]);
  const loggedIn=useCallback(()=>{if(params.get('recovery'))router.replace('/near-chat');void reload();},[params,router,reload]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{if(profile&&params.get('link'))setDialog('link');},[profile,params]);
  const fail=useCallback((cause:unknown)=>{if(cause instanceof ChatApiError&&cause.status===401){setProfile(null);setMessages([]);setRooms([]);}setError(cause instanceof Error?cause.message:'Could not reach NearChat.');},[]);
  const refreshRooms=useCallback(async()=>{const r=await chatApi<{rooms:Room[]}>('/rooms');setRooms(r.rooms);},[]);
  const refreshContacts=useCallback(async()=>{try{const r=await chatApi<{contacts:Contact[]}>('/contacts');setContacts(r.contacts);}catch{}},[]);
  const refreshStatuses=useCallback(async()=>{try{const r=await chatApi<{statuses:StatusItem[]}>('/statuses');setStatuses(r.statuses);}catch{}},[]);

  useEffect(()=>{ if(!profile) return; void refreshContacts(); void refreshStatuses(); const t=setInterval(()=>void refreshStatuses(),15000); return ()=>clearInterval(t); },[profile,refreshContacts,refreshStatuses]);

  useEffect(()=>{
    if(!profile)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const r=await chatApi<{rooms:Room[]}>('/rooms');if(!cancelled){setRooms(r.rooms);if(activeRef.current&&!r.rooms.some(room=>room.id===activeRef.current))setActive('');}}catch(cause){if(!cancelled)fail(cause);}if(!cancelled)timer=setTimeout(()=>void poll(),document.hidden?15000:4000);}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[profile,fail]);

  useEffect(()=>{
    setMessages([]);setMore(false);setDraft('');pending.current=null;readRef.current=0;historyExhausted.current=false;setReplyTo(null);
    if(!active||!profile)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;setLoadingMessages(true);
    async function poll(){try{
      const r=await chatApi<{messages:Message[];hasMore:boolean}>(`/rooms/${active}/messages`);
      if(cancelled)return;const nearBottom=!scroller.current||scroller.current.scrollHeight-scroller.current.scrollTop-scroller.current.clientHeight<120;
      setMessages(items=>merge(items,r.messages));setMore(!historyExhausted.current&&r.hasMore);setError('');setLoadingMessages(false);
      if(nearBottom)requestAnimationFrame(()=>bottom.current?.scrollIntoView({block:'nearest'}));
      const last=r.messages.at(-1)?.sequence||0;
      if(!document.hidden&&last>readRef.current){await chatApi(`/rooms/${active}/read`,{sequence:last});readRef.current=last;}
    }catch(cause){if(!cancelled){setLoadingMessages(false);fail(cause);}}if(!cancelled)timer=setTimeout(()=>void poll(),document.hidden?15000:2200);}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[active,profile,fail]);

  useEffect(()=>{ const close=()=>setMenu(null); window.addEventListener('click',close); window.addEventListener('scroll',close,true); return ()=>{window.removeEventListener('click',close); window.removeEventListener('scroll',close,true);} },[]);

  async function send(payload?:{body?:string;kind?:'text'|'image'|'call';attachment?:string|null}){
    if(!active||sending) return; const body=(payload?.body??draft).trim(); const kind=payload?.kind||'text';
    if(kind==='text' && !body) return; setSending(true);setError('');const roomId=active;
    const value={id:crypto.randomUUID(),body,roomId,kind,attachment:payload?.attachment||null,replyTo:replyTo?.id||null,forwarded:!!forward};
    pending.current={id:value.id,roomId};
    try{await chatApi(`/rooms/${roomId}/messages`,{id:value.id,body:value.body,kind:value.kind,attachment:value.attachment,replyTo:value.replyTo,forwarded:value.forwarded}); if(activeRef.current===roomId){setDraft('');setReplyTo(null);setForward(null);pending.current=null;const r=await chatApi<{messages:Message[]}>(`/rooms/${roomId}/messages`);if(activeRef.current===roomId){setMessages(items=>merge(items,r.messages));requestAnimationFrame(()=>bottom.current?.scrollIntoView({block:'nearest'}));}} await refreshRooms();}catch(cause){fail(cause);}finally{setSending(false);}
  }
  async function older(){const first=messages[0];if(!first)return;try{const r=await chatApi<{messages:Message[];hasMore:boolean}>(`/rooms/${active}/messages?before=${first.sequence}`);if(activeRef.current!==first.roomId)return;setMessages(items=>merge(r.messages,items));historyExhausted.current=!r.hasMore;setMore(r.hasMore);}catch(cause){fail(cause);}}
  async function signOut(){try{await chatApi('/sign-out',{});await authClient()?.auth.signOut({scope:'local'});setProfile(null);setRooms([]);setMessages([]);setActive('');setDialog(null);}catch(cause){fail(cause);}}
  function closeDialog(){setDialog(null);if(params.get('link'))router.replace('/near-chat');}

  function openMenu(e:React.MouseEvent|React.TouchEvent|React.PointerEvent,m:Message){ e.preventDefault(); const anyE=e as any; const x=anyE.clientX || anyE.touches?.[0]?.clientX || 120; const y=anyE.clientY || anyE.touches?.[0]?.clientY || 120; setMenu({x:Math.min(window.innerWidth-220,Math.max(10,x)), y:Math.min(window.innerHeight-260,Math.max(10,y)), message:m}); }
  async function copyMsg(m:Message){ if(m.body) await navigator.clipboard?.writeText(m.body).catch(()=>{}); setMenu(null); }
  async function deleteMsg(m:Message){ try{await chatApi(`/rooms/${m.roomId}/messages/${m.id}`,{},'DELETE'); setMessages(items=>items.map(x=>x.id===m.id?{...x,deleted:true,body:'',attachment:null}:x));}catch(cause){fail(cause);} setMenu(null); }
  function replyMsg(m:Message){ setReplyTo(m); setMenu(null); }
  function forwardMsg(m:Message){ setForward(m); setDraft(m.body||''); setMenu(null); }

  function pickImage(e:React.ChangeEvent<HTMLInputElement>){ const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{const img=new Image(); img.onload=()=>{const c=document.createElement('canvas'); const max=1280; const s=Math.min(max/img.width,max/img.height,1); c.width=Math.max(1,Math.round(img.width*s)); c.height=Math.max(1,Math.round(img.height*s)); c.getContext('2d')?.drawImage(img,0,0,c.width,c.height); void send({body:draft.trim(),kind:'image',attachment:c.toDataURL('image/jpeg',0.82)});}; img.src=String(r.result||'');}; r.readAsDataURL(f); e.target.value=''; }

  // audio call (WebRTC signaling via server polling)
  const callRef = useRef<CallState|null>(null), callStateRef = useRef<'idle'|'calling'|'incoming'|'active'>('idle');
  useEffect(()=>{ callRef.current=call; callStateRef.current=callState; },[call,callState]);

  function cleanupCall(callId?:string){
    if(callId) handledCalls.current.add(callId);
    try{ pc.current?.close(); }catch{}
    pc.current=null;
    try{ localStream.current?.getTracks().forEach(t=>t.stop()); }catch{}
    localStream.current=null;
    if(remoteAudio.current) remoteAudio.current.srcObject=null;
    seenIce.current=new Set();
    setCall(null);
    setCallState('idle');
  }

  async function ensurePeer(targetId:string){
    if(pc.current) return pc.current;
    const conn=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]});
    pc.current=conn;
    conn.onicecandidate=e=>{ if(e.candidate) void chatApi('/calls',{action:'ice',callId:targetId,payload:JSON.stringify(e.candidate)}).catch(()=>{}); };
    conn.ontrack=e=>{ const a=remoteAudio.current; if(a){ a.srcObject=e.streams[0]; void a.play().catch(()=>{}); } };
    conn.onconnectionstatechange=()=>{ if(['failed','disconnected','closed'].includes(conn.connectionState)){ const cur=callRef.current; if(cur) void endCall('end'); } };
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    localStream.current=stream;
    stream.getTracks().forEach(t=>conn.addTrack(t,stream));
    return conn;
  }

  async function startCall(){
    const room=rooms.find(r=>r.id===active);
    if(!room||room.kind!=='direct'||!profile) return;
    if(callStateRef.current!=='idle') return;
    try{
      const r=await chatApi<{id:string;call?:CallState}>('/calls',{action:'start',roomId:active});
      const callId=r.id;
      handledCalls.current.delete(callId);
      const c=(r.call as CallState|undefined) || ({id:callId,roomId:active,callerId:profile.id,calleeId:room.members.find(m=>m.id!==profile.id)?.id||'',kind:'audio',status:'ringing',callerIce:[],calleeIce:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as CallState);
      setCall(c); setCallState('calling');
      const conn=await ensurePeer(callId);
      const offer=await conn.createOffer({offerToReceiveAudio:true});
      await conn.setLocalDescription(offer);
      await chatApi('/calls',{action:'offer',callId,payload:JSON.stringify(offer)});
    }catch(cause){
      const msg=cause instanceof Error?cause.message:String(cause);
      if(/denied|permission|notallowed/i.test(msg)) setError('Microphone access denied. Izinkan mikrofon di browser (ikon kunci/site settings) lalu coba lagi.');
      else fail(cause);
      cleanupCall();
    }
  }

  async function answerCall(){
    const cur=callRef.current;
    if(!cur || callStateRef.current!=='incoming') return;
    try{
      const conn=await ensurePeer(cur.id);
      if(cur.offer && !conn.currentRemoteDescription){
        await conn.setRemoteDescription(JSON.parse(cur.offer));
      }
      if(!conn.localDescription){
        const ans=await conn.createAnswer();
        await conn.setLocalDescription(ans);
        await chatApi('/calls',{action:'answer',callId:cur.id,payload:JSON.stringify(ans)});
      } else {
        await chatApi('/calls',{action:'answer',callId:cur.id,payload:JSON.stringify(conn.localDescription)});
      }
      setCallState('active');
    }catch(cause){
      const msg=cause instanceof Error?cause.message:String(cause);
      if(/denied|permission|notallowed/i.test(msg)) setError('Microphone access denied. Izinkan mikrofon untuk menerima panggilan.');
      else fail(cause);
      await chatApi('/calls',{action:'decline',callId:cur.id}).catch(()=>{});
      cleanupCall(cur.id);
    }
  }

  async function endCall(status:'end'|'decline'='end'){
    const cur=callRef.current;
    if(cur){
      handledCalls.current.add(cur.id);
      await chatApi('/calls',{action:status,callId:cur.id}).catch(()=>{});
      cleanupCall(cur.id);
    } else {
      cleanupCall();
    }
  }

  useEffect(()=>{
    if(!profile) return;
    let stopped=false;
    let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{
        const activeId=activeRef.current;
        if(activeId){
          const r=await chatApi<{call:CallState|null}>(`/calls?roomId=${activeId}`);
          if(stopped) return;
          const c=r.call;
          const cur=callRef.current;
          const st=callStateRef.current;

          if(!c){
            // no active call record
          } else if(['ended','declined','missed'].includes(c.status)){
            handledCalls.current.add(c.id);
            if(cur?.id===c.id || st!=='idle') cleanupCall(c.id);
          } else if(c.status==='ringing'){
            if(st==='idle' && c.calleeId===profileRef.current?.id && !handledCalls.current.has(c.id)){
              setCall(c); setCallState('incoming');
            } else if(cur?.id===c.id){
              setCall(c);
            }
          } else if(c.status==='active'){
            if(cur?.id===c.id){
              setCall(c);
              const conn=pc.current;
              if(conn){
                if(c.answer && conn.localDescription && !conn.currentRemoteDescription){
                  await conn.setRemoteDescription(JSON.parse(c.answer)).catch(()=>{});
                }
                const ices=(profileRef.current?.id===c.callerId?c.calleeIce:c.callerIce)||[];
                for(const raw of ices){
                  if(raw && !seenIce.current.has(raw)){
                    seenIce.current.add(raw);
                    try{ await conn.addIceCandidate(JSON.parse(raw)); }catch(_){}
                  }
                }
              }
              if(st==='calling' || st==='incoming') setCallState('active');
            } else if(st==='idle' && c.calleeId===profileRef.current?.id && !handledCalls.current.has(c.id)){
              // missed ringing window but call became active (rare) - ignore
            }
          }
        }
      } catch(_) { /* ignore poll errors */ }
      if(!stopped) timer=setTimeout(()=>{void poll();},1500);
    }
    void poll();
    return ()=>{stopped=true; clearTimeout(timer);};
  },[profile,active]);

  if(loading)return <main className="nc-loading"><MessageCircle size={30}/><p>Opening NearChatÃ¢â‚¬Â¦</p></main>;
  if(!profile||params.get('recovery'))return <><AuthScreen onLogin={loggedIn} recovery={!!params.get('recovery')}/>{error&&<div className="nc-global-error" role="alert">{error}<button onClick={()=>void reload()}>Try again</button></div>}</>;
  const room=rooms.find(r=>r.id===active);
  const filtered=rooms.filter(r=>title(r,profile.id).toLowerCase().includes(query.toLowerCase()));
  const statusGroups=[...new Set(statuses.map(s=>s.userId))].map(id=>statuses.filter(s=>s.userId===id));

  return <div className={`nc-shell ${active?'conversation-open':''}`} onContextMenu={e=>{ if((e.target as HTMLElement).closest('.nc-bubble')) e.preventDefault(); }}>
    <aside className="nc-sidebar"><header><Link href="/" className="nc-home" aria-label="Back to NearSpace"><ArrowUpRight size={18}/></Link><span className="nc-wordmark"><MessageCircle/> NearChat</span><ThemeButton/></header>
    <div className="nc-tabs"><button className={tab==='chats'?'active':''} onClick={()=>setTab('chats')}>Chats</button><button className={tab==='status'?'active':''} onClick={()=>setTab('status')}>Status</button><button className={tab==='calls'?'active':''} onClick={()=>setTab('calls')}>Calls</button></div>
    {tab==='chats'&&<>
    <div className="nc-sidebar-title"><h1>Chats<span>{rooms.length}</span></h1><div style={{display:'flex',gap:6}}><button className="nc-icon" aria-label="Add contact" onClick={()=>setDialog('contact')}><UserPlus size={20}/></button><button className="nc-icon" aria-label="New conversation" onClick={()=>setDialog('new')}><Plus size={22}/></button></div></div>
    <label className="nc-search"><Search size={17}/><input aria-label="Search conversations" placeholder="Find a conversation" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <nav className="nc-conversations" aria-label="Conversations">{filtered.map(r=>{ const peer=r.kind==='direct'?r.members.find(m=>m.id!==profile.id):null; return <button key={r.id} className={r.id===active?'active':''} onClick={()=>{setActive(r.id);setError('');}}><Avatar name={title(r,profile.id)} avatar={peer?.avatar||null} group={r.kind==='group'}/><span><strong>{title(r,profile.id)}</strong><small>{r.kind==='group'?`${r.members.length} members`:(peer?.phone||'Private conversation')}</small></span><div><time>{new Date(r.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{r.unread>0&&<b>{r.unread}</b>}</div></button>;})}{!rooms.length&&<div className="nc-list-empty"><MessageCircle size={26}/><p>Your people will be here.</p><button onClick={()=>setDialog('new')}>Start your first chat</button></div>}</nav></>}
    {tab==='status'&&<div className="nc-status-tab"><button className="nc-primary" onClick={()=>setDialog('status')}><Camera size={16}/> Add status</button><div className="nc-status-list">{statusGroups.map(group=>{const s=group[0]; return <button key={s.userId} className="nc-status-item" onClick={()=>setViewStatus(group)}><Avatar name={s.displayName} avatar={s.avatar||null}/><span><strong>{s.displayName}{s.mine?' (You)':''}</strong><small>{new Date(s.createdAt).toLocaleString()}</small></span></button>;})}{!statuses.length&&<p className="nc-date">No status updates yet. Status expires in 24 hours.</p>}</div></div>}
    {tab==='calls'&&<div className="nc-status-tab"><p className="nc-date">Audio calls are available in direct chats. Open a direct chat and tap the call button.</p><div className="nc-status-list">{rooms.filter(r=>r.kind==='direct').slice(0,20).map(r=>{const peer=r.members.find(m=>m.id!==profile.id); return <button key={r.id} className="nc-status-item" onClick={()=>{setTab('chats');setActive(r.id);}}><Avatar name={title(r,profile.id)} avatar={peer?.avatar||null}/><span><strong>{title(r,profile.id)}</strong><small>Tap to open chat and call</small></span><Phone size={16}/></button>;})}</div></div>}
    <footer><button className="nc-profile" onClick={()=>setDialog('profile')}><Avatar name={profile.displayName} avatar={profile.avatar||null} size={40}/><span><strong>{profile.displayName}</strong><small>{profile.phone||('@'+profile.username)}</small></span><Settings2 size={17}/></button><div className="nc-shortcuts"><button onClick={()=>setDialog('link')}><Link2 size={17}/> Link</button><button onClick={()=>setDialog('devices')}><MonitorSmartphone size={17}/> Devices</button><button onClick={()=>void signOut()} aria-label="Sign out"><LogOut size={17}/></button></div></footer></aside>

    <main className="nc-conversation" id="main-content">{room?<><header><button className="nc-icon nc-mobile-back" aria-label="Back to chats" onClick={()=>setActive('')}><ArrowLeft/></button><Avatar name={title(room,profile.id)} avatar={room.kind==='direct'?room.members.find(m=>m.id!==profile.id)?.avatar||null:null} group={room.kind==='group'}/><button className="nc-room-title" onClick={()=>setDialog('info')}><strong>{title(room,profile.id)}</strong><span>{room.kind==='group'?`${room.members.length} people Â· Group details`: (room.members.find(m=>m.id!==profile.id)?.phone||'Conversation details')}</span></button>{room.kind==='direct'&&<button className="nc-icon" aria-label="Audio call" onClick={()=>void startCall()}><Phone size={18}/></button>}</header>
      {error&&<div className="nc-error-bar" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
      <div className="nc-message-list" ref={scroller}>{more&&<button className="nc-load-more" onClick={()=>void older()}>Load older messages</button>}{loadingMessages&&<p className="nc-date">Loading conversationÃ¢â‚¬Â¦</p>}{!loadingMessages&&!messages.length&&<div className="nc-chat-empty"><h2>Say something good.</h2><p>Send the first message in this conversation.</p></div>}
      {messages.map((m,index)=>{ const reply=m.replyTo?messages.find(x=>x.id===m.replyTo)||null:null; return <div key={m.id}>{(index===0||new Date(messages[index-1].createdAt).toDateString()!==new Date(m.createdAt).toDateString())&&<p className="nc-date">{new Date(m.createdAt).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'})}</p>}
      <article className={`nc-bubble ${m.senderId===profile.id?'own':''} ${m.deleted?'deleted':''}`} onContextMenu={e=>openMenu(e,m)} onPointerDown={e=>{ if(e.pointerType==='touch'){pressTimer.current=setTimeout(()=>openMenu(e as any,m),450);} }} onPointerUp={()=>clearTimeout(pressTimer.current)} onPointerLeave={()=>clearTimeout(pressTimer.current)}>
        {room.kind==='group'&&m.senderId!==profile.id&&<strong>{m.senderName}</strong>}
        <MessageBody m={m} reply={reply}/>
        <footer><time>{new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{m.senderId===profile.id&&!m.deleted&&<span className={m.read?'read':''} title={m.read?'Read':'Sent'}>{m.read?<CheckCheck size={14}/>:<Check size={14}/>}</span>}</footer>
      </article></div>;})}<div ref={bottom}/></div>
      {replyTo&&<div className="nc-compose-extra"><div><strong>Replying to {replyTo.senderName}</strong><span>{replyTo.body.slice(0,80)}</span></div><button onClick={()=>setReplyTo(null)}><X size={16}/></button></div>}
      {forward&&<div className="nc-compose-extra"><div><strong>Forwarding message</strong><span>{forward.body.slice(0,80)||'Photo'}</span></div><button onClick={()=>{setForward(null);setDraft('');}}><X size={16}/></button></div>}
      <form className="nc-composer" onSubmit={e=>{e.preventDefault();void send();}}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage}/>
        <button type="button" className="nc-icon" aria-label="Send image" onClick={()=>fileRef.current?.click()}><ImageIcon size={20}/></button>
        <textarea aria-label="Message" placeholder="Write a messageÃ¢â‚¬Â¦" value={draft} maxLength={4000} rows={1} disabled={sending} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
        <button aria-label="Send message" className="nc-send" disabled={!draft.trim()||sending}><Send size={20}/></button>
      </form>
    </>:<div className="nc-welcome"><span><MessageCircle size={45}/></span><h2>A little closer.</h2><p>Choose a conversation, or start a new one. You can add contacts by username/number, post status, send images, and make audio calls.</p><div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}><button className="nc-primary" onClick={()=>setDialog('new')}><Plus size={17}/> New conversation</button><button className="nc-secondary" onClick={()=>setDialog('contact')}><UserPlus size={17}/> Add contact</button></div><small>Account-protected rooms. Messages are not end-to-end encrypted.</small></div>}</main>

    {menu&&<div className="nc-context-menu" style={{left:menu.x,top:menu.y}} onClick={e=>e.stopPropagation()}>
      <button onClick={()=>void copyMsg(menu.message)}><Copy size={15}/> Copy</button>
      <button onClick={()=>replyMsg(menu.message)}><Reply size={15}/> Reply</button>
      <button onClick={()=>forwardMsg(menu.message)}><Forward size={15}/> Forward</button>
      {menu.message.senderId===profile.id&&!menu.message.deleted&&<button onClick={()=>void deleteMsg(menu.message)} className="danger"><Trash2 size={15}/> Delete</button>}
    </div>}

    {callState==='incoming'&&call&&<div className="nc-call-overlay"><div className="nc-call-card incoming"><div className="nc-call-icon pulse"><PhoneIncoming size={28}/></div><h3>Incoming audio call</h3><p className="nc-call-name">{rooms.find(r=>r.id===call.roomId)?title(rooms.find(r=>r.id===call.roomId)!,profile.id):'Someone'}</p><small>NearChat audio call</small><div className="nc-call-actions"><button className="nc-call-btn accept" onClick={()=>void answerCall()}><Phone size={18}/> Accept</button><button className="nc-call-btn decline" onClick={()=>void endCall('decline')}><PhoneOff size={18}/> Decline</button></div></div></div>}
    {(callState==='calling'||callState==='active')&&call&&<div className="nc-call-overlay"><div className="nc-call-card"><div className={`nc-call-icon ${callState==='calling'?'pulse':''}`}><Phone size={28}/></div><h3>{callState==='calling'?'Calling…':'On call'}</h3><p className="nc-call-name">{rooms.find(r=>r.id===call.roomId)?title(rooms.find(r=>r.id===call.roomId)!,profile.id):''}</p><small>{callState==='calling'?'Ringing':'Audio connected'}</small><div className="nc-call-actions"><button className="nc-call-btn decline" onClick={()=>void endCall('end')}><PhoneOff size={18}/> End</button></div></div></div>}
    <audio ref={remoteAudio} autoPlay playsInline />

    {dialog==='new'&&<NewConversation contacts={contacts} onClose={closeDialog} onCreated={id=>{void refreshRooms().then(()=>{setActive(id);setDialog(null);}).catch(fail);}}/>}
    {dialog==='contact'&&<AddContactDialog onClose={closeDialog} onAdded={c=>{setContacts(v=>[...v.filter(x=>x.id!==c.id),c]); setDialog('new');}}/>}
    {dialog==='profile'&&<ProfileDialog profile={profile} onClose={closeDialog} onSaved={value=>{setProfile(value);setDialog(null); void refreshRooms();}}/>}
    {dialog==='status'&&<StatusDialog onClose={closeDialog} onSaved={()=>{setDialog(null); void refreshStatuses();}}/>}
    {viewStatus&&<StatusViewer statuses={viewStatus} onClose={()=>setViewStatus(null)} onDelete={id=>{void chatApi(`/statuses/${id}`,{},'DELETE').then(()=>{setStatuses(s=>s.filter(x=>x.id!==id)); setViewStatus(v=>v?v.filter(x=>x.id!==id):null);}).catch(fail);}}/>}
    {dialog==='link'&&<LinkDevice initialCode={params.get('link')||''} onClose={closeDialog}/>}
    {dialog==='devices'&&<DevicesDialog onClose={closeDialog}/>}
    {dialog==='info'&&room&&<Modal title="Conversation details" onClose={closeDialog}><div className="nc-form"><h3>{title(room,profile.id)}</h3>{room.members.map(m=><div className="nc-session" key={m.id}><Avatar name={m.displayName} avatar={(m as any).avatar||null} size={36}/><span><strong>{m.displayName}</strong><small>@{m.username}{(m as any).phone?` Â· ${(m as any).phone}`:''}</small></span></div>)}<p>Only members can access this room. Messages are stored on the server and protected by account authorization and HTTPS. This version does not use end-to-end encryption.</p>{room.kind==='group'&&<button className="nc-secondary" onClick={()=>setDialog('leave')}>{room.ownerId===profile.id?'Delete group':'Leave group'}</button>}</div></Modal>}
    {dialog==='leave'&&room&&<Modal title={room.ownerId===profile.id?'Delete this group?':'Leave this group?'} onClose={closeDialog}><div className="nc-form"><p>{room.ownerId===profile.id?'This permanently deletes the group and its messages for all members.':'You will lose access to this conversation.'}</p><button className="nc-primary" onClick={()=>void chatApi(`/rooms/${room.id}/leave`,{}).then(()=>{setActive('');setDialog(null);void refreshRooms();}).catch(fail)}>Confirm</button><button className="nc-secondary" onClick={closeDialog}>Cancel</button></div></Modal>}
  </div>;
}



