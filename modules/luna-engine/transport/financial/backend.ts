import {
  EngineTransportError,
  checkedUtf8Length,
  parseBoundedTransportReply,
  parseTransportReply,
} from "../protocol";
import type {
  BackendFinancialPreparation,
  BackendFinancialProof,
  BackendFinancialTicket,
  FinancialCollationBackend,
  FinancialRankPayload,
} from "./protocol";
import { FINANCIAL_COLLATION_LIMITS as limits } from "./protocol";
import {
  digest,
  expectedFinancialScope,
  financialReason,
  checkFinancialMetadata,
  preparedMetadata,
  type ExpectedFinancialScope,
  record,
} from "./wire";

export interface FinancialEndpoint {
  invoke(
    operation:
      | "financialCollationPrepare"
      | "financialCollationCandidates"
      | "financialCollationAbort"
      | "collectRetired",
    json: string,
  ): Promise<string>;
  finalize(header: string, originalRanks: string): Promise<string>;
  current(): boolean;
  retire(): void;
}
interface Resource {
  readonly endpoint: FinancialEndpoint;
  readonly expected: ExpectedFinancialScope;
  readonly id: number;
  readonly digest: string;
  readonly cached: boolean;
  closed: boolean;
}
interface Proof {
  readonly endpoint: FinancialEndpoint;
  readonly token: number;
  readonly digest: string;
  readonly localeKey: string;
  readonly intent: Record<string, unknown>;
}
const id = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
/** Every opaque locator belongs to one fixed native/worker incarnation. */
export class FinancialResourceBackend implements FinancialCollationBackend {
  private readonly resources = new WeakMap<BackendFinancialTicket, Resource>();
  private readonly proofs = new WeakMap<BackendFinancialProof, Proof>();
  constructor(private readonly endpoint: () => Promise<FinancialEndpoint>) {}
  async prepare(original: string): Promise<BackendFinancialPreparation> {
    const expected = expectedFinancialScope(original);
    const endpoint = await this.endpoint();
    this.current(endpoint);
    const raw = await endpoint.invoke("financialCollationPrepare", original);
    this.current(endpoint);
    const metadata = this.read(endpoint, raw, expected);
    return this.checked(endpoint, () => {
      if (metadata.state === "FINANCIAL_COLLATION_UNAVAILABLE") {
        financialReason(metadata.reason);
        return { state: "UNAVAILABLE", metadata };
      }
      const prep = preparedMetadata(metadata);
      if (!id(metadata.draftId))
        throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
      const ticket = Object.freeze({}) as BackendFinancialTicket;
      this.resources.set(ticket, {
        endpoint,
        expected,
        id: metadata.draftId,
        digest: prep.candidateDigest,
        cached: prep.cachedVerifiedRanks,
        closed: false,
      });
      return { state: "PREPARED", ticket, metadata };
    });
  }
  async candidates(ticket: BackendFinancialTicket, after: number | null, limit: number) {
    const state = this.open(ticket);
    if (
      (after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > limits.pageItems
    )
      throw new EngineTransportError("INVALID_FINANCIAL_PAGE");
    const raw = await state.endpoint.invoke(
      "financialCollationCandidates",
      JSON.stringify({ draftId: state.id, candidateDigest: state.digest, after, limit }),
    );
    this.current(state.endpoint);
    this.open(ticket);
    const value = this.read(state.endpoint, raw, state.expected);
    return this.checked(state.endpoint, () => {
      if (value.state !== "FINANCIAL_COLLATION_CANDIDATES" || value.draftId !== state.id)
        throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
      return value;
    });
  }
  async finalize(ticket: BackendFinancialTicket, payload: FinancialRankPayload) {
    const state = this.open(ticket);
    const cached = payload.kind === "NATIVE_CACHE";
    if (cached && !state.cached) throw new EngineTransportError("FINANCIAL_CACHE_UNAVAILABLE");
    const rawRanks = cached ? "" : payload.json;
    checkedUtf8Length(rawRanks, limits.rankBytes);
    const raw = await state.endpoint.finalize(
      JSON.stringify({ draftId: state.id, candidateDigest: state.digest, reuseCached: cached }),
      rawRanks,
    );
    this.current(state.endpoint);
    this.open(ticket);
    const metadata = this.read(state.endpoint, raw, state.expected);
    return this.checked(state.endpoint, () => {
      if (
        metadata.state !== "FINANCIAL_COLLATION_READY" ||
        !id(metadata.token) ||
        !digest(metadata.digest) ||
        metadata.candidateDigest !== state.digest
      )
        throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
      const proof = Object.freeze({}) as BackendFinancialProof;
      this.proofs.set(proof, {
        endpoint: state.endpoint,
        token: metadata.token,
        digest: metadata.digest,
        localeKey: state.expected.scope.localeKey as string,
        intent: state.expected.scope.intent as Record<string, unknown>,
      });
      state.closed = true;
      return { proof, metadata };
    });
  }
  async abort(ticket: BackendFinancialTicket): Promise<void> {
    const state = this.resources.get(ticket);
    if (!state) throw new EngineTransportError("INVALID_FINANCIAL_TICKET");
    if (state.closed) return;
    this.current(state.endpoint);
    state.closed = true;
    const raw = await state.endpoint.invoke(
      "financialCollationAbort",
      JSON.stringify({ draftId: state.id }),
    );
    this.current(state.endpoint);
    const value = parseTransportReply(raw);
    if (!value.ok) throw new EngineTransportError("FINANCIAL_COLLATION_REJECTED");
    this.checked(state.endpoint, () => {
      if (
        !value.ok ||
        value.state !== "FINANCIAL_COLLATION_ABORTED" ||
        typeof value.aborted !== "boolean" ||
        value.wireSchemaVersion !== state.expected.schema ||
        value.engineVersion !== state.expected.engine ||
        value.calculationContractVersion !== state.expected.contract
      )
        throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
    });
    // Destruction is queued behind the tiny control cancellation, never inline.
    void state.endpoint.invoke("collectRetired", "").catch(() => {});
  }
  /** Internal detail-admission seam; never exposed on a public receipt. */
  proofFields(proof: BackendFinancialProof) {
    const value = this.proofs.get(proof);
    if (!value) throw new EngineTransportError("INVALID_FINANCIAL_PROOF");
    this.current(value.endpoint);
    return { token: value.token, digest: value.digest, localeKey: value.localeKey };
  }
  bindDetails(proof: BackendFinancialProof, original: string): string {
    const locator = this.proofFields(proof);
    const value = this.proofs.get(proof)!;
    checkedUtf8Length(original, 8192);
    let command: unknown;
    try {
      command = JSON.parse(original);
    } catch {
      throw new EngineTransportError("INVALID_FINANCIAL_DETAILS_REQUEST");
    }
    if (
      !record(command) ||
      !record(command.command) ||
      command.command.kind !== "CALCULATE" ||
      !record(command.command.request) ||
      Object.hasOwn(command.command.request, "financialDetails")
    )
      throw new EngineTransportError("INVALID_FINANCIAL_DETAILS_REQUEST");
    // This is bounded request metadata only. The native admission checks actual
    // source/intent/period/section compatibility and private proof retention.
    command.command.request.financialDetails = {
      filter: value.intent.filter,
      includeSpecialDutyPay: value.intent.includeSpecialDutyPay,
      collation: locator,
    };
    const encoded = JSON.stringify(command);
    checkedUtf8Length(encoded, 8192);
    return encoded;
  }
  private open(ticket: BackendFinancialTicket) {
    const state = this.resources.get(ticket);
    if (!state) throw new EngineTransportError("INVALID_FINANCIAL_TICKET");
    if (state.closed) throw new EngineTransportError("FINANCIAL_TICKET_CLOSED");
    this.current(state.endpoint);
    return state;
  }
  private current(endpoint: FinancialEndpoint) {
    if (!endpoint.current()) throw new EngineTransportError("WORKER_REPLACED");
  }
  private read(endpoint: FinancialEndpoint, raw: string, expected: ExpectedFinancialScope) {
    const value = this.checked(endpoint, () => parseBoundedTransportReply(raw, limits.pageBytes));
    // A legitimate stale/evicted/resource rejection concerns this operation;
    // it must not reset the incarnation containing a newer successful intent.
    if (!value.ok) throw new EngineTransportError("FINANCIAL_COLLATION_REJECTED");
    this.checked(endpoint, () => checkFinancialMetadata(value, expected));
    return value;
  }
  private checked<T>(endpoint: FinancialEndpoint, read: () => T): T {
    try {
      return read();
    } catch (error) {
      endpoint.retire();
      throw error;
    }
  }
}
