import Link from 'next/link';
import { MessageCircle, ArrowUpRight } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { ThemeButton } from '@/components/theme-button';
import './nearspace.css';
export const metadata={title:{absolute:'NearSpace'},description:'NearSpace applications.'};
export default function NearSpace(){return <div className="nearspace"><header><Link href="/" className="nearspace-brand">near<span>space</span><i>.</i></Link><ThemeButton/></header><main id="main-content" aria-label="Choose an application"><div className="nearspace-apps"><Link href="/drop" className="nearspace-app neardrop-app"><span className="nearspace-app-icon"><BrandMark/></span><span>NearDrop</span><ArrowUpRight className="nearspace-open" size={18}/></Link><Link href="/near-chat" className="nearspace-app nearchat-app"><span className="nearspace-app-icon"><MessageCircle size={40} strokeWidth={1.7}/></span><span>NearChat</span><ArrowUpRight className="nearspace-open" size={18}/></Link></div></main></div>;}
