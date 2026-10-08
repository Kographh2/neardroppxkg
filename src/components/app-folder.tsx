'use client';
import Link from 'next/link';
import { Folder, ArrowUpRight } from 'lucide-react';
import { BrandMark } from './brand';

// Add future applications here; each entry has its own real destination.
const applications = [{ name: 'NearDrop', href: '/drop', description: 'Open. Connect. Drop. Done.' }];
export function AppFolder() {
  return <section className="application-shelf" aria-label="Applications"><details className="app-folder"><summary><Folder size={26}/><span><strong>Your applications</strong><small>{applications.length} app · open folder</small></span><ArrowUpRight size={20}/></summary>
    <div className="folder-apps">{applications.map(app => <Link key={app.href} href={app.href} className="folder-app"><BrandMark/><strong>{app.name}</strong><small>{app.description}</small></Link>)}</div>
  </details><Link className="text-button" href="/android">NearDrop for Android <ArrowUpRight size={16}/></Link></section>;
}
