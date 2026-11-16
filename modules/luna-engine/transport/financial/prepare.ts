import { EngineTransportError } from "../protocol";
import type { LocaleRankPort, LocaleRankTicket } from "../locale/protocol";
import type {
  FinancialCandidatePage,
  FinancialCollationPreparation,
  FinancialCollationReceipt,
  FinancialCollationTicket,
  FinancialRankPayload,
  FinancialUnavailableReason,
} from "./protocol";
import { expectedFinancialScope } from "./wire";
interface Client {
  financialCollationPrepare(
    json: string,
    options: { isCurrent: () => boolean },
  ): Promise<FinancialCollationPreparation>;
  financialCollationCandidates(
    ticket: FinancialCollationTicket,
    options: { after: number | null; limit: number },
  ): Promise<FinancialCandidatePage>;
  financialCollationFinalize(
    ticket: FinancialCollationTicket,
    payload: FinancialRankPayload,
  ): Promise<FinancialCollationReceipt>;
  financialCollationAbort(ticket: FinancialCollationTicket): Promise<void>;
}
export type PreparedFinancialCollation =
  | { readonly state: "READY"; readonly receipt: FinancialCollationReceipt }
  | { readonly state: "UNAVAILABLE"; readonly reason: FinancialUnavailableReason };
/** Native structural union → platform locale worker → native admission proof.
 * No rank map is parsed, sorted or materialized on the UI/React Native thread. */
export async function prepareFinancialCollation(
  client: Client,
  ranker: Pick<LocaleRankPort, "begin" | "append" | "finish" | "cancel">,
  originalHeader: string,
  options: { readonly isCurrent: () => boolean },
): Promise<PreparedFinancialCollation> {
  const expected = expectedFinancialScope(originalHeader);
  const current = () => {
    let valid = false;
    try {
      valid = options.isCurrent();
    } catch {}
    if (!valid) throw new EngineTransportError("STALE_FINANCIAL_COLLATION");
  };
  let ticket: FinancialCollationTicket | undefined,
    ranking: LocaleRankTicket | undefined,
    completed = false;
  try {
    current();
    const prepared = await client.financialCollationPrepare(originalHeader, options);
    if (prepared.state === "PREPARED") ticket = prepared.ticket;
    current();
    if (prepared.state === "UNAVAILABLE") return prepared;
    ticket = prepared.ticket;
    if (prepared.cachedVerifiedRanks) {
      const receipt = await client.financialCollationFinalize(ticket, { kind: "NATIVE_CACHE" });
      current();
      completed = true;
      return { state: "READY", receipt };
    }
    ranking = await ranker.begin(options);
    current();
    let after: number | null = null,
      received = 0;
    do {
      const page = await client.financialCollationCandidates(ticket, { after, limit: 512 });
      current();
      if (
        page.candidateDigest !== prepared.candidateDigest ||
        page.total !== prepared.total ||
        received + page.candidates.length > prepared.total
      )
        throw new EngineTransportError("INVALID_FINANCIAL_PAGE");
      await ranker.append(ranking, page.candidates);
      current();
      received += page.candidates.length;
      if (page.nextAfter !== null && (page.nextAfter !== received || page.candidates.length === 0))
        throw new EngineTransportError("INVALID_FINANCIAL_PAGE");
      after = page.nextAfter;
    } while (after !== null);
    if (received !== prepared.total) throw new EngineTransportError("INVALID_FINANCIAL_PAGE");
    const originalRanks = await ranker.finish(ranking);
    ranking = undefined;
    current();
    if (originalRanks.localeKey !== expected.scope.localeKey)
      throw new EngineTransportError("FINANCIAL_LOCALE_MISMATCH");
    const receipt = await client.financialCollationFinalize(ticket, {
      kind: "ORIGINAL_RANKS",
      json: originalRanks.json,
    });
    current();
    completed = true;
    return { state: "READY", receipt };
  } finally {
    if (ranking) ranker.cancel(ranking);
    if (ticket && !completed) await client.financialCollationAbort(ticket).catch(() => {});
  }
}
