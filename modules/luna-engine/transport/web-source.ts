import { EngineTransportError, parseTransportReply, type EngineOperation } from "./protocol";
import type { BackendSourceTicket, SourceBackend } from "./source";
import { sourceBuilderId, sourceFrame } from "./source-wire";

type Invoke = (operation: EngineOperation, json: string) => Promise<string>;
type RawInvoke = (header: string, source: string) => Promise<string>;
export interface SourcePair {
  readonly supported: boolean;
  readonly commands: readonly [Invoke, Invoke];
  readonly raw: readonly [RawInvoke, RawInvoke];
  readonly ranks?: readonly [RawInvoke, RawInvoke];
  readonly catalogFinalize?: readonly [RawInvoke, RawInvoke];
  readonly profileClock?: boolean;
  current(): boolean;
  retire(): void;
}
interface Binding {
  pair: SourcePair;
  ids: readonly [number, number];
  closed: boolean;
}

/** Numeric IDs may differ or be reused in replacement Wasm instances. */
export class WebSourceBackend implements SourceBackend {
  private readonly bindings = new WeakMap<BackendSourceTicket, Binding>();
  constructor(private readonly acquire: () => Promise<SourcePair>) {}
  async begin(header: string): Promise<BackendSourceTicket> {
    const pair = await this.acquire();
    if (!pair.supported) throw new EngineTransportError("SOURCE_BUILDER_UNAVAILABLE");
    try {
      const replies = await Promise.all(
        pair.commands.map((invoke) => invoke("snapshotBegin", header)),
      );
      if (!pair.current()) throw new EngineTransportError("STALE_SOURCE_TICKET");
      const ids = [sourceBuilderId(replies[0]), sourceBuilderId(replies[1])] as const;
      const ticket = Object.freeze({}) as BackendSourceTicket;
      this.bindings.set(ticket, { pair, ids, closed: false });
      return ticket;
    } catch {
      pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_BEGIN_FAILED");
    }
  }
  async source(ticket: BackendSourceTicket, header: string, source: string) {
    const binding = this.get(ticket);
    // Reject malformed small metadata before any call, without retiring a core.
    const headers = binding.ids.map((id) => sourceFrame(header, id));
    try {
      const replies = await Promise.all(
        binding.pair.raw.map((invoke, index) => invoke(headers[index], source)),
      );
      this.ensure(binding);
      if (replies.some((reply) => !parseTransportReply(reply).ok)) throw new Error();
      return replies[0];
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_GROUP_FAILED");
    }
  }
  async candidates(ticket: BackendSourceTicket, after: number | null, limit: number) {
    const binding = this.get(ticket);
    if (!binding.pair.ranks) throw new EngineTransportError("SOURCE_PREFLIGHT_UNAVAILABLE");
    try {
      const reply = await binding.pair.commands[0](
        "snapshotCalendarCandidates",
        JSON.stringify({ builderId: binding.ids[0], after, limit }),
      );
      this.ensure(binding);
      if (!parseTransportReply(reply).ok) throw new Error();
      return reply;
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_PREFLIGHT_FAILED");
    }
  }
  async ranks(ticket: BackendSourceTicket, body: string) {
    const binding = this.get(ticket);
    if (!binding.pair.ranks) throw new EngineTransportError("SOURCE_PREFLIGHT_UNAVAILABLE");
    try {
      const replies = await Promise.all(
        binding.pair.ranks.map((invoke, index) =>
          invoke(JSON.stringify({ builderId: binding.ids[index] }), body),
        ),
      );
      this.ensure(binding);
      if (replies.some((reply) => !parseTransportReply(reply).ok)) throw new Error();
      return replies[0];
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_RANKS_FAILED");
    }
  }
  async seal(ticket: BackendSourceTicket) {
    const binding = this.get(ticket);
    try {
      const replies = await Promise.all(
        binding.pair.commands.map((invoke, index) =>
          invoke("snapshotSeal", JSON.stringify({ builderId: binding.ids[index] })),
        ),
      );
      this.ensure(binding);
      const values = replies.map(parseTransportReply);
      if (
        values.some((reply) => !reply.ok || reply.state !== "REGISTERED") ||
        JSON.stringify(values[0].identity) !== JSON.stringify(values[1].identity)
      )
        throw new Error();
      binding.closed = true;
      return replies[0];
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_SEAL_FAILED");
    }
  }
  async catalogCandidates(ticket: BackendSourceTicket, after: number | null, limit: number) {
    const binding = this.get(ticket);
    if (!binding.pair.catalogFinalize) throw new EngineTransportError("SOURCE_CATALOG_UNAVAILABLE");
    try {
      const reply = await binding.pair.commands[0](
        "snapshotCatalogCandidates",
        JSON.stringify({ builderId: binding.ids[0], after, limit }),
      );
      this.ensure(binding);
      if (!parseTransportReply(reply).ok) throw new Error();
      return reply;
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_CATALOG_FAILED");
    }
  }
  async catalogFinalize(ticket: BackendSourceTicket, body: string) {
    const binding = this.get(ticket);
    if (!binding.pair.catalogFinalize) throw new EngineTransportError("SOURCE_CATALOG_UNAVAILABLE");
    try {
      const replies = await Promise.all(
        binding.pair.catalogFinalize.map((invoke, index) =>
          invoke(JSON.stringify({ builderId: binding.ids[index] }), body),
        ),
      );
      this.ensure(binding);
      const values = replies.map(parseTransportReply);
      if (
        values.some(
          (value) =>
            !value.ok ||
            !["CATALOG_FINALIZED", "CATALOG_UNAVAILABLE"].includes(value.state as string),
        ) ||
        JSON.stringify(values[0]) !== JSON.stringify(values[1])
      )
        throw new Error();
      return replies[0];
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_CATALOG_FINALIZE_FAILED");
    }
  }
  async profileClock(ticket: BackendSourceTicket, observedEpochMilliseconds: number) {
    const binding = this.get(ticket);
    if (!binding.pair.profileClock)
      throw new EngineTransportError("SOURCE_PROFILE_CLOCK_UNAVAILABLE");
    try {
      const replies = await Promise.all(
        binding.pair.commands.map((invoke, index) =>
          invoke(
            "snapshotProfileClock",
            JSON.stringify({
              builderId: binding.ids[index],
              epochMilliseconds: observedEpochMilliseconds,
            }),
          ),
        ),
      );
      this.ensure(binding);
      const values = replies.map(parseTransportReply);
      if (
        values.some(
          (value) =>
            !value.ok ||
            !["PROFILE_CLOCK_READY", "PROFILE_CLOCK_UNAVAILABLE"].includes(value.state as string),
        ) ||
        JSON.stringify(values[0]) !== JSON.stringify(values[1])
      )
        throw new Error();
      return replies[0];
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_PROFILE_CLOCK_FAILED");
    }
  }
  async abort(ticket: BackendSourceTicket) {
    const binding = this.bindings.get(ticket);
    if (!binding) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    if (!binding.pair.current()) throw new EngineTransportError("STALE_SOURCE_TICKET");
    if (binding.closed) return;
    binding.closed = true;
    try {
      const replies = await Promise.all(
        binding.pair.commands.map((invoke, index) =>
          invoke("snapshotAbort", JSON.stringify({ builderId: binding.ids[index] })),
        ),
      );
      if (replies.some((reply) => !parseTransportReply(reply).ok)) throw new Error();
      if (binding.pair.current())
        void Promise.all(binding.pair.commands.map((invoke) => invoke("collectRetired", ""))).catch(
          () => {},
        );
    } catch {
      binding.pair.retire();
      throw new EngineTransportError("SOURCE_PAIR_ABORT_FAILED");
    }
  }
  private get(ticket: BackendSourceTicket) {
    const binding = this.bindings.get(ticket);
    if (!binding) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    this.ensure(binding);
    return binding;
  }
  private ensure(binding: Binding) {
    if (!binding.pair.current()) throw new EngineTransportError("STALE_SOURCE_TICKET");
    if (binding.closed) throw new EngineTransportError("SOURCE_TICKET_CLOSED");
  }
}
