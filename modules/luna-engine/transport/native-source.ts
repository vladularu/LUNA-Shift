import { EngineTransportError, parseTransportReply, type EngineOperation } from "./protocol";
import type { BackendSourceTicket, SourceBackend } from "./source";
import { sourceBuilderId, sourceFrame } from "./source-wire";

export class NativeSourceBackend implements SourceBackend {
  private readonly tickets = new WeakMap<BackendSourceTicket, { id: number; closed: boolean }>();
  constructor(
    private readonly invoke: (operation: EngineOperation, json: string) => Promise<string>,
    private readonly raw: (header: string, body: string) => Promise<string>,
    private readonly rawRanks?: (header: string, body: string) => Promise<string>,
    private readonly rawCatalog?: (header: string, body: string) => Promise<string>,
  ) {}
  async begin(headerJson: string): Promise<BackendSourceTicket> {
    const id = sourceBuilderId(await this.invoke("snapshotBegin", headerJson));
    const ticket = Object.freeze({}) as BackendSourceTicket;
    this.tickets.set(ticket, { id, closed: false });
    return ticket;
  }
  source(ticket: BackendSourceTicket, header: string, body: string): Promise<string> {
    const state = this.open(ticket);
    return this.raw(sourceFrame(header, state.id), body);
  }
  candidates(ticket: BackendSourceTicket, after: number | null, limit: number): Promise<string> {
    const state = this.open(ticket);
    return this.invoke(
      "snapshotCalendarCandidates",
      JSON.stringify({ builderId: state.id, after, limit }),
    );
  }
  ranks(ticket: BackendSourceTicket, body: string): Promise<string> {
    const state = this.open(ticket);
    if (!this.rawRanks) throw new EngineTransportError("SOURCE_PREFLIGHT_UNAVAILABLE");
    return this.rawRanks(JSON.stringify({ builderId: state.id }), body);
  }
  catalogCandidates(
    ticket: BackendSourceTicket,
    after: number | null,
    limit: number,
  ): Promise<string> {
    const state = this.open(ticket);
    return this.invoke(
      "snapshotCatalogCandidates",
      JSON.stringify({ builderId: state.id, after, limit }),
    );
  }
  catalogFinalize(ticket: BackendSourceTicket, body: string): Promise<string> {
    const state = this.open(ticket);
    if (!this.rawCatalog) throw new EngineTransportError("SOURCE_CATALOG_UNAVAILABLE");
    return this.rawCatalog(JSON.stringify({ builderId: state.id }), body);
  }
  profileClock(ticket: BackendSourceTicket, observedEpochMilliseconds: number): Promise<string> {
    const state = this.open(ticket);
    return this.invoke(
      "snapshotProfileClock",
      JSON.stringify({ builderId: state.id, epochMilliseconds: observedEpochMilliseconds }),
    ).then((json) => {
      const reply = parseTransportReply(json);
      if (
        !reply.ok ||
        !["PROFILE_CLOCK_READY", "PROFILE_CLOCK_UNAVAILABLE"].includes(reply.state as string)
      )
        throw new EngineTransportError("SOURCE_PROFILE_CLOCK_REJECTED");
      return json;
    });
  }
  async seal(ticket: BackendSourceTicket): Promise<string> {
    const state = this.open(ticket);
    const json = await this.invoke("snapshotSeal", JSON.stringify({ builderId: state.id }));
    const reply = parseTransportReply(json);
    if (!reply.ok || reply.state !== "REGISTERED")
      throw new EngineTransportError("SOURCE_SEAL_REJECTED");
    state.closed = true;
    return json;
  }
  async abort(ticket: BackendSourceTicket): Promise<void> {
    const state = this.tickets.get(ticket);
    if (!state) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    if (state.closed) return;
    state.closed = true;
    const reply = parseTransportReply(
      await this.invoke("snapshotAbort", JSON.stringify({ builderId: state.id })),
    );
    if (!reply.ok) throw new EngineTransportError("SOURCE_ABORT_REJECTED");
    void this.invoke("collectRetired", "").catch(() => {});
  }
  private open(ticket: BackendSourceTicket) {
    const state = this.tickets.get(ticket);
    if (!state) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    if (state.closed) throw new EngineTransportError("SOURCE_TICKET_CLOSED");
    return state;
  }
}
