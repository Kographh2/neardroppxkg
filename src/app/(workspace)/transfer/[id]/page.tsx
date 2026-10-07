'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { usePlatform } from '@/lib/hooks';
import { api } from '@/lib/api';
import type { Transfer } from '@/shared/protocol';
import { TransferCard } from '@/components/transfer-card';
export default function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const state = usePlatform(); const [saved, setSaved] = useState<Transfer | null>(null); const [error, setError] = useState('');
  const transfer = state.transfers.find(t => t.id === id) || saved;
  useEffect(() => { if (state.status === 'online') void api<{ transfer: Transfer }>(`/transfers/${id}`).then(r => setSaved(r.transfer)).catch(e => setError(e.message)); }, [id, state.status]);
  return <><Link className="text-button muted-text back-link" href="/drop"><ArrowLeft size={16}/> Back to transfers</Link><div className="page-heading"><div><span className="eyebrow">THE DETAILS</span><h1>Your transfer.</h1><p>From one screen to the next.</p></div></div>{transfer ? <><div className="transfer-list"><TransferCard transfer={transfer}/></div><dl className="transfer-details surface"><div><dt>From</dt><dd>{transfer.senderName}</dd></div><div><dt>To</dt><dd>{transfer.receiverName}</dd></div><div><dt>Connection</dt><dd>{transfer.transport === 'direct' ? 'Direct connection' : transfer.transport ? 'Secure relay' : 'Not established yet'}</dd></div><div><dt>Started</dt><dd>{new Date(transfer.createdAt).toLocaleString()}</dd></div><div><dt>Transfer ID</dt><dd className="monospace">{transfer.id}</dd></div></dl><div className="info-banner"><ShieldCheck size={19}/><p>File contents are encrypted in transit. A completed transfer means the receiving browser has received the item. Use Save file on that device to keep it.</p></div></> : <p className="empty-state">{error || 'Finding your transfer…'}</p>}</>;
}
