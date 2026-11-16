import type { TransportReply } from "../protocol";

declare const draft: unique symbol;
declare const receipt: unique symbol;
declare const backendDraft: unique symbol;
declare const backendProof: unique symbol;
export interface FinancialCollationTicket {
  readonly [draft]: true;
}
export interface FinancialCollationReceipt {
  readonly [receipt]: true;
}
export interface BackendFinancialTicket {
  readonly [backendDraft]: true;
}
export interface BackendFinancialProof {
  readonly [backendProof]: true;
}
export interface FinancialUnavailableReason {
  readonly code: string;
  readonly source?: string;
  readonly catalog?: string;
}
export type FinancialRankPayload =
  { readonly kind: "NATIVE_CACHE" } | { readonly kind: "ORIGINAL_RANKS"; readonly json: string };
export type FinancialCollationPreparation =
  | {
      readonly state: "PREPARED";
      readonly ticket: FinancialCollationTicket;
      readonly candidateDigest: string;
      readonly total: number;
      readonly cachedVerifiedRanks: boolean;
    }
  | { readonly state: "UNAVAILABLE"; readonly reason: FinancialUnavailableReason };
export interface FinancialCandidatePage {
  readonly candidates: readonly string[];
  readonly nextAfter: number | null;
  readonly total: number;
  readonly candidateDigest: string;
}
export type BackendFinancialPreparation =
  | {
      readonly state: "PREPARED";
      readonly ticket: BackendFinancialTicket;
      readonly metadata: TransportReply;
    }
  | { readonly state: "UNAVAILABLE"; readonly metadata: TransportReply };
/** Private locators are retained inside the matching backend incarnation. */
export interface FinancialCollationBackend {
  /** Internal small-envelope binding; public callers never supply proof locators. */
  bindDetails?: (proof: BackendFinancialProof, originalSmallCalculateEnvelope: string) => string;
  prepare(originalSmallEnvelope: string): Promise<BackendFinancialPreparation>;
  candidates(
    ticket: BackendFinancialTicket,
    after: number | null,
    limit: number,
  ): Promise<TransportReply>;
  finalize(
    ticket: BackendFinancialTicket,
    payload: FinancialRankPayload,
  ): Promise<{ readonly proof: BackendFinancialProof; readonly metadata: TransportReply }>;
  abort(ticket: BackendFinancialTicket): Promise<void>;
}
export const FINANCIAL_COLLATION_LIMITS = Object.freeze({
  prepareBytes: 8192,
  pageBytes: 1048576,
  drafts: 4,
  proofs: 8,
  channels: 128,
  pageItems: 1024,
  candidates: 100000,
  rankBytes: 33554432,
});
