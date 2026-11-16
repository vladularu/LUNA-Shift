export type AdmissionPriority = "INTERACTIVE" | "BACKGROUND";
/** Bounded metadata scheduling only. Native queue limits remain authoritative. */
export class AdmissionGate<T> {
  private readonly waiting = new Map<T, AdmissionPriority>();
  private readonly held = new Map<T, AdmissionPriority>();
  private scheduled = false;
  private paused = false;
  private retry?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly active: (ticket: T) => boolean,
    private readonly start: (ticket: T) => void,
    private readonly limit = 12,
  ) {}
  enqueue(ticket: T, priority: AdmissionPriority): void {
    this.waiting.set(ticket, priority);
    this.schedule();
  }
  cancelWaiting(ticket: T): void {
    this.waiting.delete(ticket);
  }
  has(ticket: T): boolean {
    return this.held.has(ticket);
  }
  release(ticket: T): void {
    this.held.delete(ticket);
    this.schedule();
  }
  capacity(ticket: T, priority: AdmissionPriority): void {
    this.held.delete(ticket);
    this.waiting.set(ticket, priority);
    this.paused = true;
    if (this.retry === undefined)
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.paused = false;
        this.schedule();
      }, 16);
  }
  progress(): void {
    this.paused = false;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = undefined;
    this.schedule();
  }
  clear(): void {
    this.waiting.clear();
    this.held.clear();
    this.paused = false;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = undefined;
  }
  private schedule(): void {
    if (this.scheduled || this.paused || this.waiting.size === 0) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      this.drain();
    });
  }
  private drain(): void {
    if (this.paused) return;
    for (const ticket of this.waiting.keys()) if (!this.active(ticket)) this.waiting.delete(ticket);
    while (this.held.size < this.limit) {
      let next = [...this.waiting].find(([, priority]) => priority === "INTERACTIVE");
      if (!next) {
        // Preserve admission room for a visible page arriving after warmup.
        const backgrounds = [...this.held.values()].filter((p) => p === "BACKGROUND").length;
        if (backgrounds >= Math.max(1, this.limit - 2)) break;
        next = this.waiting.entries().next().value;
      }
      if (!next) break;
      const [ticket, priority] = next;
      this.waiting.delete(ticket);
      if (!this.active(ticket)) continue;
      this.held.set(ticket, priority);
      this.start(ticket);
    }
  }
}
/** The original small envelope is forwarded unchanged; only scheduling metadata
 * is inspected. Missing/invalid metadata stays native validation's concern. */
export function requestPriority(json: string): AdmissionPriority {
  try {
    const value = JSON.parse(json);
    return value?.command?.request?.priority === "BACKGROUND" ? "BACKGROUND" : "INTERACTIVE";
  } catch {
    return "INTERACTIVE";
  }
}
