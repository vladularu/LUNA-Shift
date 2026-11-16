import { checkedRawSourceString } from "../protocol";
import { localeProbe } from "./core";
import {
  LOCALE_LIMITS,
  LocaleRankerError,
  type BackendRankTicket,
  type LocaleBackend,
  type LocaleRankReceipt,
  type LocaleRankTicket,
  type LocaleRankPort,
  type RankerCode,
} from "./protocol";
interface Session {
  generation: number;
  sequence: number;
  localeKey: string;
  native?: BackendRankTicket;
  tail: Promise<void>;
  state: "OPEN" | "FINISHING" | "CLOSED";
  items: number;
  units: number;
  cancelSent?: boolean;
  current?: () => boolean;
}
interface Pending {
  session?: Session;
  reject: (error: LocaleRankerError) => void;
}
function error(value: unknown): LocaleRankerError {
  return value instanceof LocaleRankerError ? value : new LocaleRankerError("RUNTIME_FAILURE");
}

/** Small-page host facade. Candidate sets/sort/rank maps remain in the backend. */
export class LocaleRanker implements LocaleRankPort {
  private generation = 0;
  private sequence = 0;
  private owner?: string;
  private closed = false;
  private active?: Session;
  private ready: Promise<void> = Promise.resolve();
  private readonly pending = new Set<Pending>();
  private readonly tickets = new WeakMap<LocaleRankTicket, Session>();
  private readonly detach?: () => void;
  constructor(private readonly backend: LocaleBackend) {
    this.detach = backend.onFault?.(() => this.invalidate("RUNTIME_FAILURE", false));
  }
  bindOwner(ownerKey: string): void {
    this.ensureOpen();
    if (typeof ownerKey !== "string" || ownerKey.length === 0 || ownerKey.length > 256)
      throw new LocaleRankerError("INVALID_COMMAND");
    this.owner = ownerKey;
    this.invalidate("CANCELED", true);
  }
  probe(): Promise<{ readonly localeKey: string }> {
    const generation = this.generation;
    return this.track(undefined, async () => {
      this.ensure(generation);
      const signature = this.captureProbe();
      await this.ready;
      this.ensure(generation);
      const localeKey = await this.backend.probe(signature);
      this.ensure(generation);
      if (localeKey !== signature) throw new LocaleRankerError("LOCALE_MISMATCH");
      return Object.freeze({ localeKey });
    });
  }
  begin(options: { readonly isCurrent?: () => boolean } = {}): Promise<LocaleRankTicket> {
    try {
      this.ensureOpen();
      if (!this.owner) throw new LocaleRankerError("OWNER_REQUIRED");
    } catch (value) {
      return Promise.reject(error(value));
    }
    if (this.active) this.fail(this.active, "CANCELED");
    if (this.sequence >= Number.MAX_SAFE_INTEGER)
      return Promise.reject(new LocaleRankerError("LIMIT"));
    const session: Session = {
      generation: this.generation,
      sequence: ++this.sequence,
      localeKey: "",
      tail: Promise.resolve(),
      state: "OPEN",
      items: 0,
      units: 0,
      current: options.isCurrent,
    };
    this.active = session;
    return this.track(session, async () => {
      session.localeKey = this.captureProbe();
      await this.ready;
      this.ensureSession(session);
      session.native = await this.backend.begin(session.localeKey);
      try {
        this.ensureSession(session);
      } catch (value) {
        this.cancelNative(session);
        throw value;
      }
      const ticket = Object.freeze({}) as LocaleRankTicket;
      this.tickets.set(ticket, session);
      return ticket;
    });
  }
  append(ticket: LocaleRankTicket, strings: readonly string[]): Promise<void> {
    let session: Session;
    let copy: string[];
    try {
      session = this.open(ticket);
      if (
        !Array.isArray(strings) ||
        strings.length > LOCALE_LIMITS.pageItems ||
        session.items + strings.length > LOCALE_LIMITS.candidates
      )
        throw new LocaleRankerError("LIMIT");
      copy = [];
      let units = 0;
      for (const text of strings) {
        if (typeof text !== "string") throw new LocaleRankerError("INVALID_COMMAND");
        try {
          checkedRawSourceString(text, LOCALE_LIMITS.stringBytes);
        } catch {
          throw new LocaleRankerError("INVALID_COMMAND");
        }
        units += text.length;
        if (units > LOCALE_LIMITS.pageUnits) throw new LocaleRankerError("LIMIT");
        copy.push(text);
      }
      if (session.units + units > LOCALE_LIMITS.inputBytes) throw new LocaleRankerError("LIMIT");
      session.items += copy.length;
      session.units += units;
    } catch (value) {
      return Promise.reject(error(value));
    }
    return this.enqueue(session, async () => {
      await this.backend.append(this.native(session), copy);
    });
  }
  finish(ticket: LocaleRankTicket): Promise<LocaleRankReceipt> {
    let session: Session;
    try {
      session = this.open(ticket);
      if (this.pending.size >= LOCALE_LIMITS.pending) throw new LocaleRankerError("LIMIT");
      session.state = "FINISHING";
    } catch (value) {
      return Promise.reject(error(value));
    }
    return this.enqueue(session, async () => {
      const receipt = await this.backend.finish(this.native(session));
      this.ensureSession(session);
      if (receipt.localeKey !== session.localeKey) throw new LocaleRankerError("LOCALE_MISMATCH");
      checkedRawSourceString(receipt.json, LOCALE_LIMITS.inputBytes);
      session.state = "CLOSED";
      if (this.active === session) this.active = undefined;
      return Object.freeze({ json: receipt.json, localeKey: receipt.localeKey });
    });
  }
  cancel(ticket: LocaleRankTicket): void {
    const session = this.tickets.get(ticket);
    if (!session) throw new LocaleRankerError("INVALID_COMMAND");
    if (
      session.generation !== this.generation ||
      session.sequence !== this.sequence ||
      session.state === "CLOSED"
    )
      return;
    this.fail(session, "CANCELED");
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invalidate("CLOSED", false);
    this.detach?.();
    this.backend.close();
  }
  private captureProbe(): string {
    try {
      return localeProbe();
    } catch {
      throw new LocaleRankerError("LOCALE_UNAVAILABLE");
    }
  }
  private native(session: Session): BackendRankTicket {
    if (!session.native) throw new LocaleRankerError("STALE");
    return session.native;
  }
  private open(ticket: LocaleRankTicket): Session {
    const session = this.tickets.get(ticket);
    if (!session) throw new LocaleRankerError("INVALID_COMMAND");
    this.ensureSession(session, true);
    if (session.state !== "OPEN") throw new LocaleRankerError("CLOSED");
    return session;
  }
  private enqueue<T>(session: Session, invoke: () => Promise<T>): Promise<T> {
    if (this.pending.size >= LOCALE_LIMITS.pending)
      return Promise.reject(new LocaleRankerError("LIMIT"));
    const before = session.tail;
    let drained!: () => void;
    session.tail = new Promise<void>((resolve) => {
      drained = resolve;
    });
    return this.track(session, async () => {
      try {
        await before;
        this.ensureSession(session);
        return await invoke();
      } catch (value) {
        this.fail(session, error(value).code);
        throw value;
      } finally {
        drained();
      }
    });
  }
  private track<T>(session: Session | undefined, run: () => Promise<T>): Promise<T> {
    if (this.pending.size >= LOCALE_LIMITS.pending)
      return Promise.reject(new LocaleRankerError("LIMIT"));
    let resolve!: (value: T) => void;
    let reject!: (reason: LocaleRankerError) => void;
    let settled = false;
    const result = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const operation: Pending = {
      session,
      reject: (reason) => {
        if (settled) return;
        settled = true;
        this.pending.delete(operation);
        reject(reason);
      },
    };
    this.pending.add(operation);
    void (async () => {
      try {
        const value = await run();
        if (session) this.ensureSession(session, true);
        else this.ensureOpen();
        if (!settled) {
          settled = true;
          this.pending.delete(operation);
          resolve(value);
        }
      } catch (value) {
        const reason = error(value);
        if (session) this.fail(session, reason.code);
        operation.reject(reason);
      }
    })();
    return result;
  }
  private ensureOpen(): void {
    if (this.closed) throw new LocaleRankerError("CLOSED");
  }
  private ensure(generation: number): void {
    this.ensureOpen();
    if (generation !== this.generation) throw new LocaleRankerError("STALE");
  }
  private ensureSession(session: Session, finished = false): void {
    this.ensure(session.generation);
    if (session.sequence !== this.sequence || (!finished && session.state === "CLOSED"))
      throw new LocaleRankerError("STALE");
    try {
      if (session.current && !session.current()) throw new Error();
    } catch {
      throw new LocaleRankerError("STALE");
    }
  }
  private fail(session: Session, code: RankerCode): void {
    session.state = "CLOSED";
    if (this.active === session) this.active = undefined;
    for (const operation of [...this.pending])
      if (operation.session === session) operation.reject(new LocaleRankerError(code));
    this.cancelNative(session);
  }
  private cancelNative(session: Session): void {
    if (session.native && !session.cancelSent && session.generation === this.generation) {
      session.cancelSent = true;
      void this.backend.cancel(session.native).catch(() => {});
    }
  }
  private invalidate(code: RankerCode, reset: boolean): void {
    this.generation++;
    if (this.active) this.active.state = "CLOSED";
    this.active = undefined;
    for (const operation of [...this.pending]) operation.reject(new LocaleRankerError(code));
    if (reset) {
      this.ready = this.backend.reset();
      void this.ready.catch(() => {});
    }
  }
}
