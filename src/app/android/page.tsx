import Link from 'next/link';
import { ArrowLeft, Download, Smartphone } from 'lucide-react';
import { Brand } from '@/components/brand';
import releases from '@/generated/android-releases.json';
import { formatBytes } from '@/shared/protocol';
interface Release { version: string; url: string; size: number; sha256: string }
export default function AndroidPage() {
  const versions = releases as Release[];
  return <div className="document-page"><header><Brand/><Link href="/drop" className="text-button"><ArrowLeft size={16}/> Back to NearDrop</Link></header><main id="main-content"><span className="eyebrow">A HOME ON YOUR PHONE</span><h1>NearDrop for Android.</h1><p className="document-lead">Official Android releases, all in one place.</p>
    {versions.length ? versions.map((release, index) => <section className="android-release surface" key={release.version}><Smartphone size={26}/><div><span className="eyebrow">{index === 0 ? 'LATEST RELEASE' : 'PREVIOUS VERSION'}</span><h2>NearDrop {release.version}</h2><p>{formatBytes(release.size)} · Android APK</p><a className="button primary" href={release.url} download><Download size={16}/> Download APK</a><details><summary>Verify download</summary><p>SHA-256</p><code>{release.sha256}</code></details></div></section>) : <section className="android-release surface"><Smartphone size={32}/><div><span className="eyebrow">COMING SOON</span><h2>The Android app is not available yet.</h2><p>You can use NearDrop in your Android browser today. Published APKs and previous versions will appear here when available.</p><button className="button secondary-button" disabled>Install Android app</button><Link className="text-button" href="/drop">Open web app</Link></div></section>}
    <section><h2>Installing an update</h2><p>Download the latest version and open the APK on Android. Follow the system installation prompts. Updates must use the same signing key to preserve app data.</p></section></main></div>;
}
