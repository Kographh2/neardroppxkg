'use client';
import { connectionHints } from '@/lib/connection-status';
import { useRouter } from 'next/navigation';
import { PairingPanel } from '@/components/pairing';
import { usePlatform } from '@/lib/hooks';
export default function ConnectPage() { const state = usePlatform(); const router = useRouter(); return <><div className="page-heading"><div><span className="eyebrow">ONE SMALL CONNECTION</span><h1>Meet your other device.</h1><p>Open NearDrop on both devices, then scan or enter a code.</p></div></div><section className="standalone-pairing surface">{state.status === 'online' ? <PairingPanel onPaired={() => router.push('/drop')}/> : <p className="empty-state">{connectionHints[state.status]}</p>}</section></>; }
