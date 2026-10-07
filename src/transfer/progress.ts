export class ProgressMeter {
  private previousBytes = 0;
  private previousTime: number;
  private speed = 0;
  constructor(now = performance.now()) { this.previousTime = now; }
  update(bytes: number, total: number, now = performance.now()) {
    const elapsed = (now - this.previousTime) / 1000;
    if (elapsed >= 0.2) {
      const current = Math.max(0, bytes - this.previousBytes) / elapsed;
      this.speed = this.speed ? this.speed * 0.7 + current * 0.3 : current;
      this.previousBytes = bytes; this.previousTime = now;
    }
    return { bytes, percent: total ? Math.min(100, bytes / total * 100) : 0, speed: this.speed, eta: this.speed ? Math.max(0, (total - bytes) / this.speed) : null };
  }
}
