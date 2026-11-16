import {
  createWorkletRuntime,
  runOnRuntimeAsync,
  getRuntimeKind,
  type WorkletRuntime,
} from "react-native-worklets";
import { createRankState, dispatchRankCommand, type RankState } from "./core";
import { LocaleRanker } from "./client";
import {
  LocaleRankerError,
  requireRankReply,
  type BackendRankTicket,
  type LocaleBackend,
  type RankCommand,
  type RankReply,
  type LocaleRankReceipt,
} from "./protocol";
type RankGlobal = typeof globalThis & { __lunaLocaleRankerV1?: RankState };
function runtimeDispatch(command: RankCommand): RankReply {
  "worklet";
  if (getRuntimeKind() !== 3) return { ok: false, code: "RUNTIME_FAILURE" };
  const root = globalThis as RankGlobal;
  const state = root.__lunaLocaleRankerV1 ?? createRankState();
  root.__lunaLocaleRankerV1 = state;
  return dispatchRankCommand(state, command);
}
class NativeLocaleBackend implements LocaleBackend {
  private runtime?: WorkletRuntime;
  private generation = 0;
  private sequence = 0;
  private pending = 0;
  private closed = false;
  private resetPending?: Promise<void>;
  private readonly bindings = new WeakMap<
    BackendRankTicket,
    { id: number; generation: number; closed: boolean }
  >();
  async probe(signature: string): Promise<string> {
    const reply = await this.call({ kind: "PROBE", probe: signature });
    if (typeof reply.localeKey !== "string") throw new LocaleRankerError("RUNTIME_FAILURE");
    return reply.localeKey;
  }
  async begin(signature: string): Promise<BackendRankTicket> {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new LocaleRankerError("LIMIT");
    const id = ++this.sequence,
      generation = this.generation;
    const reply = await this.call({ kind: "BEGIN", id, probe: signature });
    if (reply.localeKey !== signature) throw new LocaleRankerError("LOCALE_MISMATCH");
    if (generation !== this.generation) throw new LocaleRankerError("STALE");
    const ticket = Object.freeze({}) as BackendRankTicket;
    this.bindings.set(ticket, { id, generation, closed: false });
    return ticket;
  }
  async append(ticket: BackendRankTicket, strings: readonly string[]): Promise<void> {
    await this.call({ kind: "APPEND", id: this.open(ticket).id, strings });
  }
  async finish(ticket: BackendRankTicket): Promise<LocaleRankReceipt> {
    const binding = this.open(ticket);
    const reply = await this.call({ kind: "FINISH", id: binding.id });
    if (typeof reply.json !== "string" || typeof reply.localeKey !== "string")
      throw new LocaleRankerError("RUNTIME_FAILURE");
    binding.closed = true;
    return { json: reply.json, localeKey: reply.localeKey };
  }
  async cancel(ticket: BackendRankTicket): Promise<void> {
    const binding = this.bindings.get(ticket);
    if (!binding || binding.closed || binding.generation !== this.generation) return;
    binding.closed = true;
    await this.call({ kind: "CANCEL", id: binding.id });
  }
  reset(): Promise<void> {
    this.generation++;
    if (!this.runtime) return Promise.resolve();
    if (this.resetPending) return this.resetPending;
    const pending = this.call({ kind: "RESET" }, true).then(() => {});
    this.resetPending = pending;
    void pending.then(
      () => {
        if (this.resetPending === pending) this.resetPending = undefined;
      },
      () => {
        if (this.resetPending === pending) this.resetPending = undefined;
      },
    );
    return pending;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime) {
      try {
        void runOnRuntimeAsync(runtime, runtimeDispatch, { kind: "RESET" }).catch(() => {});
      } catch {
        /* Host is already closed; no work may publish from this runtime. */
      }
    }
  }
  private open(ticket: BackendRankTicket) {
    const binding = this.bindings.get(ticket);
    if (this.closed) throw new LocaleRankerError("CLOSED");
    if (!binding || binding.closed || binding.generation !== this.generation)
      throw new LocaleRankerError("STALE");
    return binding;
  }
  private async call(command: RankCommand, reset = false) {
    if (this.closed) throw new LocaleRankerError("CLOSED");
    if (this.pending >= 16) throw new LocaleRankerError("LIMIT");
    const generation = this.generation;
    this.pending++;
    try {
      this.runtime ??= createWorkletRuntime({ name: "luna-locale", queue: "default" });
      const reply = await runOnRuntimeAsync(this.runtime, runtimeDispatch, command);
      if (this.closed || (!reset && generation !== this.generation))
        throw new LocaleRankerError("STALE");
      return requireRankReply(reply);
    } catch (value) {
      throw value instanceof LocaleRankerError ? value : new LocaleRankerError("RUNTIME_FAILURE");
    } finally {
      this.pending--;
    }
  }
}
/** Lazy dedicated Hermes runtime. No dataset work is performed on RN or UI. */
export function createNativeLocaleRanker(): LocaleRanker {
  return new LocaleRanker(new NativeLocaleBackend());
}
