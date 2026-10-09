'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { preferences } from '@/lib/local-preferences';
export function ThemeButton() {
  const [dark,setDark]=useState(false);
  useEffect(()=>setDark(document.documentElement.dataset.theme==='dark'),[]);
  return <button className="icon-button" title={dark?'Switch to light theme':'Switch to dark theme'} aria-label={dark?'Switch to light theme':'Switch to dark theme'} onClick={()=>{const next=!dark;setDark(next);document.documentElement.dataset.theme=next?'dark':'light';preferences.setItem('nd-theme',next?'dark':'light');}}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>;
}
