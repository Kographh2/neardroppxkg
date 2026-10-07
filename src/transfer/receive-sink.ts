import { MEMORY_RECEIVE_LIMIT, type ItemMetadata } from '../shared/protocol';
export interface ReceivedContent { url?: string; text?: string; saved?: boolean }
export interface ReceiveSink { write(bytes: ArrayBuffer): Promise<void>; finish(): Promise<ReceivedContent>; abort(): Promise<void>; dispose?(): Promise<void> }
interface WritableFile { write(data: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface SaveHandle { createWritable(): Promise<WritableFile> }
export type SavePicker = (options: { suggestedName: string }) => Promise<SaveHandle>;
export async function createSink(item: ItemMetadata, transferId: string): Promise<ReceiveSink> {
  // Called directly from the Accept click so a save picker retains user activation.
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (item.kind === 'file' && item.size > MEMORY_RECEIVE_LIMIT && picker) {
    const handle = await picker({ suggestedName: item.name }); const writer = await handle.createWritable();
    return { write: data => writer.write(data), finish: async () => { await writer.close(); return { saved: true }; }, abort: async () => { await writer.abort(); } };
  }
  if (item.kind === 'file' && navigator.storage?.getDirectory) {
    let directory: FileSystemDirectoryHandle | undefined;
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage && estimate.quota - estimate.usage < item.size * 1.1) throw new Error('Not enough browser storage.');
      directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('neardrop-incoming', { create: true });
      const handle = await directory.getFileHandle(transferId, { create: true });
      const writer = await handle.createWritable();
      const cleanup = async () => { try { await directory!.removeEntry(transferId); } catch { /* Already removed. */ } };
      return { write: data => writer.write(data), finish: async () => { await writer.close(); return { url: URL.createObjectURL(await handle.getFile()) }; }, abort: async () => { await writer.abort().catch(() => undefined); await cleanup(); }, dispose: cleanup };
    } catch (error) { if (item.size > MEMORY_RECEIVE_LIMIT) throw new Error(error instanceof Error ? `${error.message} Try a smaller file or another browser.` : 'This browser cannot receive a file this large.'); }
  }
  if (item.size > MEMORY_RECEIVE_LIMIT) throw new Error('This browser can receive files up to 100 MB. Send a smaller file or use a browser with disk storage support.');
  let chunks: ArrayBuffer[] = [];
  return {
    write: async data => { chunks.push(data); },
    finish: async () => {
      // Always use an inert MIME for downloaded files; never render received active content.
      const blob = new Blob(chunks, { type: item.kind === 'file' ? 'application/octet-stream' : 'text/plain;charset=utf-8' }); chunks = [];
      return item.kind === 'file' ? { url: URL.createObjectURL(blob) } : { text: await blob.text() };
    }, abort: async () => { chunks = []; }
  };
}
export async function cleanOldIncoming() {
  if (!navigator.storage?.getDirectory) return;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('neardrop-incoming', { create: true });
    // Only remove stale temporary data. Other active tabs may still own recent entries.
    const iterable = directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemFileHandle]> };
    for await (const [name, handle] of iterable.entries()) { if (handle.kind === 'file' && (await handle.getFile()).lastModified < Date.now() - 86400000) await directory.removeEntry(name); }
  } catch { /* Storage may be unavailable in private browsing. Memory fallback remains usable. */ }
}
