import { Temporal } from "@js-temporal/polyfill";
import type { SfnPremiumPayment, SfnShift, SfnTimeRange } from "@/domain/net-pay-sfn";

export function premiumKind(key: string): SfnPremiumPayment["kind"] {
  if (key === "night" || key === "NIGHT") return "NIGHT";
  return [
    "sunday",
    "holiday",
    "preholiday",
    "SUNDAY",
    "HOLIDAY_WITH_TIME_OFF",
    "HOLIDAY_WITHOUT_TIME_OFF",
    "PRE_HOLIDAY",
  ].includes(key)
    ? "DAY"
    : "OTHER";
}

export function premiumCategory(key: string): NonNullable<SfnPremiumPayment["category"]> {
  const normalized = key.toUpperCase();
  if (normalized === "NIGHT") return "NIGHT";
  if (normalized === "SUNDAY") return "SUNDAY";
  if (
    [
      "HOLIDAY",
      "PREHOLIDAY",
      "HOLIDAY_WITH_TIME_OFF",
      "HOLIDAY_WITHOUT_TIME_OFF",
      "PRE_HOLIDAY",
    ].includes(normalized)
  )
    return "HOLIDAY";
  if (normalized === "SATURDAY") return "SATURDAY";
  return "OTHER";
}

/** Exact optional side channel of the tariff engine, before different rate buckets merge. */
export class NetPayPremiumTrace {
  private readonly buckets = new Map<string, { total: number; worked: number[] }>();
  private readonly payments: SfnPremiumPayment[] = [];
  private readonly paidPause = new Set<number>();
  private readonly pauseFrom: number;
  constructor(
    private readonly id: string,
    private readonly start: number,
    private readonly grossMinutes: number,
    private readonly pauseMinutes: number,
    paidBreaks = false,
  ) {
    this.pauseFrom = Math.floor((grossMinutes - pauseMinutes) / 2);
    if (paidBreaks)
      for (let i = this.pauseFrom; i < this.pauseFrom + pauseMinutes; i++) this.paidPause.add(i);
  }
  add(key: string, epochMinute: number): void {
    const offset = epochMinute - this.start;
    const bucket = this.buckets.get(key) ?? { total: 0, worked: [] };
    bucket.total++;
    if (offset >= this.pauseFrom && offset < this.pauseFrom + this.pauseMinutes)
      this.paidPause.add(offset);
    else bucket.worked.push(epochMinute);
    this.buckets.set(key, bucket);
  }
  private ranges(minutes: readonly number[]): SfnTimeRange[] {
    const result: SfnTimeRange[] = [];
    let from: number | null = null,
      until = 0;
    for (const minute of minutes) {
      if (from !== null && minute !== until) {
        result.push(this.range(from, until));
        from = null;
      }
      if (from === null) from = minute;
      until = minute + 1;
    }
    if (from !== null) result.push(this.range(from, until));
    return result;
  }
  private range(from: number, until: number): SfnTimeRange {
    const timestamp = (value: number) =>
      Temporal.Instant.fromEpochMilliseconds(value * 60000)
        .toZonedDateTimeISO("Europe/Berlin")
        .toString({ smallestUnit: "minute", timeZoneName: "never" });
    return { start: timestamp(from), end: timestamp(until) };
  }
  private workedMinutes(): number[] {
    return Array.from({ length: this.grossMinutes }, (_, i) => i)
      .filter((i) => i < this.pauseFrom || i >= this.pauseFrom + this.pauseMinutes)
      .map((i) => this.start + i);
  }
  pay(
    key: string,
    kind: SfnPremiumPayment["kind"],
    amountCents: number,
    category?: SfnPremiumPayment["category"],
  ): void {
    const bucket = this.buckets.get(key);
    if (!bucket || !Number.isSafeInteger(amountCents) || amountCents < 0)
      throw new Error("Die Zuschlagszeitspur ist unvollständig.");
    const workedCents = Math.round((amountCents * bucket.worked.length) / bucket.total);
    if (bucket.worked.length && workedCents)
      this.payments.push({
        id: `${this.id}:${key}`,
        kind,
        category,
        amountCents: workedCents,
        additionalToBasicPay: true,
        periods: this.ranges(bucket.worked),
      });
    // Premiums paid during a break remain taxable; never extend SFN exemption over them.
    const paidBreakCents = amountCents - workedCents;
    if (paidBreakCents)
      this.payments.push({
        id: `${this.id}:${key}:pause`,
        kind: "OTHER",
        category,
        amountCents: paidBreakCents,
        additionalToBasicPay: true,
        periods: this.ranges(this.workedMinutes()),
      });
  }
  finish(): SfnShift {
    const unpaid: number[] = [],
      paid: number[] = [];
    for (let i = this.pauseFrom; i < this.pauseFrom + this.pauseMinutes; i++)
      (this.paidPause.has(i) ? paid : unpaid).push(this.start + i);
    return {
      id: this.id,
      ...this.range(this.start, this.start + this.grossMinutes),
      unpaidBreaks: this.ranges(unpaid),
      ...(paid.length ? { paidBreaks: this.ranges(paid) } : {}),
      payments: this.payments,
    };
  }
}
