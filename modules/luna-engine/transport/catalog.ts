import { EngineTransportError, type TransportReply } from "./protocol";
import type { SnapshotSourceTicket } from "./source";
import type { LocaleRankPort, LocaleRankTicket } from "./locale/protocol";
export interface NativeCatalogIds {
  readonly tariff: readonly string[];
  readonly legal: readonly string[];
  readonly holiday: readonly string[];
}
export type CatalogFinalization =
  | { readonly state: "FINALIZED"; readonly selectedPackageIds: NativeCatalogIds }
  | { readonly state: "UNAVAILABLE"; readonly code: string };
interface CatalogClient {
  snapshotCatalogCandidates(
    ticket: SnapshotSourceTicket,
    options: { readonly after: number | null; readonly limit: number },
  ): Promise<TransportReply>;
  snapshotCatalogFinalize(ticket: SnapshotSourceTicket, ranks: string): Promise<TransportReply>;
}
/** The caller scopes this optional in-memory cache to its owner and engine.
 * Cached JSON is still validated by native membership/u32/aggregate limits. */
export interface CatalogRankCache {
  get(candidateDigest: string, localeKey: string): string | undefined;
  put(candidateDigest: string, localeKey: string, originalRanksJson: string): void;
}
interface Options {
  readonly isCurrent: () => boolean;
  readonly localeKey: string;
  readonly cache?: CatalogRankCache;
}
function current(options: Options): void {
  let valid = false;
  try {
    valid = options.isCurrent();
  } catch {}
  if (!valid) throw new EngineTransportError("STALE_CATALOG");
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function ids(value: unknown): NativeCatalogIds {
  if (
    !object(value) ||
    Object.keys(value).length !== 3 ||
    !["tariff", "legal", "holiday"].every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].length === 1 &&
        typeof value[key][0] === "string" &&
        value[key][0].length > 0 &&
        value[key][0].length <= 96,
    )
  )
    throw new EngineTransportError("INVALID_CATALOG_REPLY");
  return value as unknown as NativeCatalogIds;
}
function sameIds(a: NativeCatalogIds, b: NativeCatalogIds): boolean {
  return a.tariff[0] === b.tariff[0] && a.legal[0] === b.legal[0] && a.holiday[0] === b.holiday[0];
}
function unavailable(reply: TransportReply): CatalogFinalization | undefined {
  if (reply.ok && reply.state === "CATALOG_UNAVAILABLE")
    return {
      state: "UNAVAILABLE",
      code: typeof reply.code === "string" ? reply.code : "CATALOG_UNAVAILABLE",
    };
}
/** Only small native metadata and bounded candidate pages are interpreted here.
 * Original manifests/packages are never parsed, projected or sorted in JS. */
export async function finalizeSnapshotCatalog(
  client: CatalogClient,
  ranker: Pick<LocaleRankPort, "begin" | "append" | "finish" | "cancel">,
  ticket: SnapshotSourceTicket,
  options: Options,
): Promise<CatalogFinalization> {
  let rankTicket: LocaleRankTicket | undefined;
  try {
    current(options);
    if (
      typeof options.localeKey !== "string" ||
      options.localeKey.length === 0 ||
      options.localeKey.length > 4096
    )
      throw new EngineTransportError("INVALID_CATALOG_LOCALE");
    let after: number | null = null,
      total: number | undefined,
      digest: string | undefined,
      defaults: NativeCatalogIds | undefined,
      received = 0,
      rawRanks: string | undefined,
      fresh = false;
    do {
      current(options);
      const reply = await client.snapshotCatalogCandidates(ticket, { after, limit: 512 });
      current(options);
      const missing = unavailable(reply);
      if (missing) return missing;
      if (!reply.ok || reply.state !== "CATALOG_CANDIDATES" || !object(reply.page))
        throw new EngineTransportError("INVALID_CATALOG_REPLY");
      const page = reply.page,
        selected = ids(reply.defaultPackageIds);
      if (
        !Number.isInteger(page.total) ||
        (page.total as number) < 0 ||
        (page.total as number) > 100000 ||
        typeof page.candidateDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(page.candidateDigest) ||
        !Array.isArray(page.candidates) ||
        page.candidates.length > 1024 ||
        page.candidates.some((name) => typeof name !== "string" || name.length > 300000)
      )
        throw new EngineTransportError("INVALID_CATALOG_REPLY");
      if (total === undefined) {
        total = page.total as number;
        digest = page.candidateDigest;
        defaults = selected;
        try {
          const cached = options.cache?.get(digest, options.localeKey);
          if (typeof cached === "string") rawRanks = cached;
        } catch {}
        current(options);
        if (rawRanks !== undefined) break;
        if (total === 0) {
          if (page.candidates.length !== 0 || page.nextAfter !== null)
            throw new EngineTransportError("INVALID_CATALOG_REPLY");
          rawRanks = "{}";
          break;
        }
        rankTicket = await ranker.begin({ isCurrent: options.isCurrent });
        current(options);
      } else if (
        page.total !== total ||
        page.candidateDigest !== digest ||
        !sameIds(selected, defaults!)
      )
        throw new EngineTransportError("INVALID_CATALOG_REPLY");
      received += page.candidates.length;
      if (
        received > total ||
        page.candidates.length === 0 ||
        (page.nextAfter !== null &&
          (!Number.isInteger(page.nextAfter) ||
            page.nextAfter !== received ||
            received >= total)) ||
        (page.nextAfter === null && received !== total)
      )
        throw new EngineTransportError("INVALID_CATALOG_REPLY");
      await ranker.append(rankTicket!, page.candidates as string[]);
      current(options);
      after = page.nextAfter as number | null;
    } while (after !== null);
    if (rawRanks === undefined) {
      const result = await ranker.finish(rankTicket!);
      current(options);
      if (result.localeKey !== options.localeKey)
        throw new EngineTransportError("CATALOG_LOCALE_MISMATCH");
      rawRanks = result.json;
      fresh = true;
    }
    current(options);
    const result = await client.snapshotCatalogFinalize(ticket, rawRanks);
    current(options);
    const missing = unavailable(result);
    if (missing) return missing;
    if (!result.ok || result.state !== "CATALOG_FINALIZED")
      throw new EngineTransportError("INVALID_CATALOG_REPLY");
    const selected = ids(result.selectedPackageIds);
    if (!defaults || !sameIds(selected, defaults))
      throw new EngineTransportError("INVALID_CATALOG_REPLY");
    if (fresh) {
      current(options);
      try {
        options.cache?.put(digest!, options.localeKey, rawRanks);
      } catch {}
      current(options);
    }
    return { state: "FINALIZED", selectedPackageIds: selected };
  } finally {
    if (rankTicket) {
      try {
        ranker.cancel(rankTicket);
      } catch {}
    }
  }
}
