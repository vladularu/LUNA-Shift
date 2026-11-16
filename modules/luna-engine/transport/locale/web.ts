import { LocaleRanker } from "./client";
import {
  LocaleRankerError,
  requireRankReply,
  type BackendRankTicket,
  type LocaleBackend,
  type LocaleRankReceipt,
  type RankCommand,
} from "./protocol";
export interface LocaleWorker {
  postMessage(value: unknown): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown }) => void,
  ): void;
  terminate(): void;
}
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: LocaleRankerError) => void;
}
interface Instance {
  worker: LocaleWorker;
  ready: Promise<void>;
  resolve: () => void;
  reject: (error: LocaleRankerError) => void;
  readyDone: boolean;
  pending: Map<number, Pending>;
  message: (event: { data?: unknown }) => void;
  failure: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
class WebLocaleBackend implements LocaleBackend {
  private instance?: Instance;
  private closed = false;
  private sequence = 0;
  private request = 0;
  private readonly faults = new Set<() => void>();
  private readonly bindings = new WeakMap<
    BackendRankTicket,
    { instance: Instance; id: number; closed: boolean }
  >();
  constructor(private readonly factory: () => LocaleWorker) {}
  onFault(listener: () => void) {
    this.faults.add(listener);
    return () => {
      this.faults.delete(listener);
    };
  }
  async probe(signature: string): Promise<string> {
    const instance = this.acquire();
    const reply = await this.call(instance, { kind: "PROBE", probe: signature });
    if (typeof reply.localeKey !== "string") throw new LocaleRankerError("RUNTIME_FAILURE");
    return reply.localeKey;
  }
  async begin(signature: string): Promise<BackendRankTicket> {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new LocaleRankerError("LIMIT");
    const instance = this.acquire(),
      id = ++this.sequence;
    const reply = await this.call(instance, { kind: "BEGIN", id, probe: signature });
    if (reply.localeKey !== signature) throw new LocaleRankerError("LOCALE_MISMATCH");
    const ticket = Object.freeze({}) as BackendRankTicket;
    this.bindings.set(ticket, { instance, id, closed: false });
    return ticket;
  }
  async append(ticket: BackendRankTicket, strings: readonly string[]): Promise<void> {
    const binding = this.open(ticket);
    await this.call(binding.instance, { kind: "APPEND", id: binding.id, strings });
  }
  async finish(ticket: BackendRankTicket): Promise<LocaleRankReceipt> {
    const binding = this.open(ticket);
    const reply = await this.call(binding.instance, { kind: "FINISH", id: binding.id });
    if (typeof reply.json !== "string" || typeof reply.localeKey !== "string")
      throw new LocaleRankerError("RUNTIME_FAILURE");
    binding.closed = true;
    return { json: reply.json, localeKey: reply.localeKey };
  }
  async cancel(ticket: BackendRankTicket): Promise<void> {
    const binding = this.bindings.get(ticket);
    if (!binding || binding.closed || binding.instance !== this.instance) return;
    binding.closed = true;
    await this.call(binding.instance, { kind: "CANCEL", id: binding.id });
  }
  reset(): Promise<void> {
    this.discard("CANCELED");
    return Promise.resolve();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.discard("CLOSED");
    this.faults.clear();
  }
  private open(ticket: BackendRankTicket) {
    const binding = this.bindings.get(ticket);
    if (this.closed) throw new LocaleRankerError("CLOSED");
    if (!binding || binding.closed || binding.instance !== this.instance)
      throw new LocaleRankerError("STALE");
    return binding;
  }
  private acquire(): Instance {
    if (this.closed) throw new LocaleRankerError("CLOSED");
    if (this.instance) return this.instance;
    let resolve!: () => void, reject!: (error: LocaleRankerError) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void ready.catch(() => {});
    const instance: Instance = {
      worker: this.factory(),
      ready,
      resolve,
      reject,
      readyDone: false,
      pending: new Map(),
      message: (event) => this.receive(instance, event.data),
      failure: () => this.fault(instance),
    };
    this.instance = instance;
    instance.worker.addEventListener("message", instance.message);
    instance.worker.addEventListener("error", instance.failure);
    instance.worker.addEventListener("messageerror", instance.failure);
    instance.timer = setTimeout(instance.failure, 30_000);
    return instance;
  }
  private async call(instance: Instance, command: RankCommand) {
    await instance.ready;
    if (instance !== this.instance || this.closed) throw new LocaleRankerError("STALE");
    if (instance.pending.size >= 16 || this.request >= Number.MAX_SAFE_INTEGER)
      throw new LocaleRankerError("LIMIT");
    const id = ++this.request;
    const value = await new Promise<unknown>((resolve, reject) => {
      instance.pending.set(id, { resolve, reject });
      try {
        instance.worker.postMessage({ kind: "COMMAND", id, command });
      } catch {
        instance.pending.delete(id);
        reject(new LocaleRankerError("RUNTIME_FAILURE"));
      }
    });
    if (instance !== this.instance || this.closed) throw new LocaleRankerError("STALE");
    return requireRankReply(value);
  }
  private receive(instance: Instance, value: unknown): void {
    if (instance !== this.instance) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.fault(instance);
      return;
    }
    const message = value as Record<string, unknown>;
    if (message.kind === "READY" && message.version === 1 && !instance.readyDone) {
      instance.readyDone = true;
      clearTimeout(instance.timer);
      instance.resolve();
      return;
    }
    if (
      message.kind !== "REPLY" ||
      !Number.isSafeInteger(message.id) ||
      (message.id as number) <= 0
    ) {
      this.fault(instance);
      return;
    }
    const pending = instance.pending.get(message.id as number);
    if (!pending) return;
    instance.pending.delete(message.id as number);
    pending.resolve(message.reply);
  }
  private fault(instance: Instance): void {
    if (instance !== this.instance) return;
    this.discard("RUNTIME_FAILURE");
    for (const listener of this.faults) {
      try {
        listener();
      } catch {}
    }
  }
  private discard(code: "CANCELED" | "CLOSED" | "RUNTIME_FAILURE"): void {
    const instance = this.instance;
    this.instance = undefined;
    if (!instance) return;
    clearTimeout(instance.timer);
    instance.worker.removeEventListener("message", instance.message);
    instance.worker.removeEventListener("error", instance.failure);
    instance.worker.removeEventListener("messageerror", instance.failure);
    instance.worker.terminate();
    const error = new LocaleRankerError(code);
    instance.reject(error);
    for (const pending of instance.pending.values()) pending.reject(error);
    instance.pending.clear();
  }
}
export function createWebLocaleRanker(
  workerUrl: string | URL,
  factory?: () => LocaleWorker,
): LocaleRanker {
  return new LocaleRanker(
    new WebLocaleBackend(
      factory ?? (() => new Worker(workerUrl, { type: "module", name: "luna-locale" })),
    ),
  );
}
