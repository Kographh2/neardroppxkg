'use client';
import { useState } from 'react';
import { Clock3, Search, Trash2 } from 'lucide-react';
import { usePlatform } from '@/lib/hooks';
import { platform } from '@/lib/platform-client';
import { TransferCard } from '@/components/transfer-card';
import { Modal } from '@/components/primitives';
export default function HistoryPage() {
  usePlatform(); const [query, setQuery] = useState(''); const [clear, setClear] = useState(false);
  const history = platform.visibleHistory().filter(t => `${t.item.name} ${t.senderName} ${t.receiverName}`.toLowerCase().includes(query.toLowerCase()));
  const today = new Date(); today.setHours(0,0,0,0); const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const groups = [{ title: 'Today', data: history.filter(t => Date.parse(t.createdAt) >= +today) }, { title: 'Yesterday', data: history.filter(t => Date.parse(t.createdAt) >= +yesterday && Date.parse(t.createdAt) < +today) }, { title: 'Earlier', data: history.filter(t => Date.parse(t.createdAt) < +yesterday) }];
  return <><div className="page-heading"><div><span className="eyebrow">A LITTLE PAPER TRAIL</span><h1>What moved where.</h1><p>A record of your transfers. File contents stay out of your history.</p></div><button className="button secondary-button small" onClick={() => setClear(true)}><Trash2 size={15}/> Clear local history</button></div><div className="search-field"><Search size={18}/><input aria-label="Search transfer history" placeholder="Find a file or device…" value={query} onChange={e => setQuery(e.target.value)}/></div>{groups.map(group => group.data.length > 0 && <section className="history-group" key={group.title}><h2>{group.title}</h2><div className="transfer-list">{group.data.map(t => <TransferCard transfer={t} key={t.id}/>)}</div></section>)}{!history.length && <div className="large-empty"><span className="feature-icon"><Clock3 size={30}/></span><h2>{query ? 'Nothing matches just yet.' : 'Nothing sent yet.'}</h2><p>{query ? 'Try another file or device name.' : 'Your completed transfers will appear here.'}</p></div>}{clear && <Modal title="Clear history on this browser?" onClose={() => setClear(false)}><p className="modal-description">This hides previous transfers on this browser. Server metadata expires after 30 days. Files you already saved are unaffected.</p><div className="modal-actions"><button className="button secondary-button" onClick={() => setClear(false)}>Keep history</button><button className="button primary" onClick={() => { platform.clearHistory(); setClear(false); }}>Clear local history</button></div></Modal>}</>;
}
