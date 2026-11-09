import { Temporal } from "@js-temporal/polyfill";
import type { TariffComplianceEvidence } from "./tariff-compliance";
import { TARIFF_SCOPE_SOURCE, TARIFF_TIME_POLICIES } from "./tariff-time-policy";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const quantity = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

/** Cache metadata may open a source link: accept only sources in the reviewed policy. */
export function validTariffComplianceEvidence(
  value: unknown,
  rule?: string,
): value is TariffComplianceEvidence {
  if (!record(value) || !record(value.period) || !record(value.source)) return false;
  const { source, period } = value;
  return (
    text(value.tariffLabel) &&
    text(value.ruleId) &&
    ["REVIEW", "DEVIATION", "PENDING", "UNAVAILABLE"].includes(String(value.status)) &&
    date(period.from) &&
    date(period.until) &&
    period.from <= period.until &&
    text(value.ruleText) &&
    Array.isArray(value.requirements) &&
    value.requirements.every(text) &&
    (value.recordedDates === undefined ||
      (Array.isArray(value.recordedDates) && value.recordedDates.every(date))) &&
    quantity(value.count) &&
    quantity(value.limit) &&
    [
      ...Object.values(TARIFF_TIME_POLICIES).flatMap((policy) => [
        policy.source,
        policy.freeSource,
      ]),
      ...(rule === "TARIFF_SCOPE" && value.status === "UNAVAILABLE" ? [TARIFF_SCOPE_SOURCE] : []),
    ].some(
      (known) =>
        known !== null &&
        source.url === known.url &&
        source.title === known.title &&
        source.section === known.section &&
        source.version === known.version,
    )
  );
}
