/** Bounded in-flight chunks. Progress counts only receiver acknowledgements. */
export class SendWindow {
  private pending = new Map<number, { promise: Promise<void>; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly capacity = 16, private timeout = 30000) {}
  async room() { if (this.pending.size >= this.capacity) await this.pending.values().next().value!.promise; }
  track(sequence: number) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void promise.catch(() => undefined);
    const timer = setTimeout(() => reject(new Error('The receiving device stopped responding. Retry this transfer.')), this.timeout);
    this.pending.set(sequence, { promise, resolve, reject, timer });
  }
  acknowledge(sequence: number) {
    const entry = this.pending.get(sequence); if (!entry) return false;
    clearTimeout(entry.timer); entry.resolve(); this.pending.delete(sequence); return true;
  }
  async drain() { await Promise.all([...this.pending.values()].map(entry => entry.promise)); }
  cancel() { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Transfer stopped.')); } this.pending.clear(); }
}
