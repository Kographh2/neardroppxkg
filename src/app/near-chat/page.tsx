import { Suspense } from 'react';
import { NearChatApp } from '../../../apps/near-chat/app';
import '../../../apps/near-chat/styles.css';
export const metadata={title:{absolute:'NearChat · NearSpace'},description:'Your conversations in NearChat.'};
export default function NearChatPage(){return <Suspense fallback={<main className="nc-loading">Opening NearChat…</main>}><NearChatApp/></Suspense>;}
