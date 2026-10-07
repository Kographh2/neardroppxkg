'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, Laptop, Monitor, Smartphone, Tablet, HardDrive } from 'lucide-react';
import type { DeviceType } from '@/shared/protocol';
export function DeviceIcon({ type, size = 24 }: { type: DeviceType; size?: number }) { const Icon = ({ laptop: Laptop, desktop: Monitor, phone: Smartphone, android: Smartphone, tablet: Tablet, unknown: HardDrive })[type]; return <Icon size={size} strokeWidth={1.6} />; }
export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null; dialog.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.close(); document.body.style.overflow = old; previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`modal ${className}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-body"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</div></dialog>;
}
export function Spinner() { return <span className="spinner" aria-hidden="true" />; }
