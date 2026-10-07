'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { platform } from './platform-client';
export function usePlatform() { const state = useSyncExternalStore(platform.subscribe, platform.getSnapshot, platform.getServerSnapshot); useEffect(() => { void platform.start(); }, []); return state; }
export function useProgress(id: string) { return useSyncExternalStore(listener => platform.subscribeProgress(id, listener), () => platform.progressSnapshot(id), () => undefined); }
