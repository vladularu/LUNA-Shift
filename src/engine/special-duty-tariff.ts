import type { SpecialDuty } from "@/domain/special-duty";
import type { UserProfile } from "@/domain/types";

export type DutyTariffFamily = "TVOED_K" | "TVOED_B" | "TVL_43" | "TVH_43" | "TVUK";

/** A family identifies a rule, not a complete individual entitlement or pay table. */
export function dutyTariffFamily(profile: UserProfile): DutyTariffFamily | null {
  if (profile.tvUkNursingTariff) return "TVUK";
  if (profile.tvhKrTariff) return "TVH_43";
  if (profile.tvalPflegeTariff)
    return profile.tvalPflegeTariff.employerScope === "SECTION_43" ? "TVL_43" : null;
  if (profile.tvlKrTariff) return "TVL_43";
  const sector =
    profile.nursingTrainingTariff?.sector ?? profile.vkaETariff?.sector ?? profile.tariff?.sector;
  return sector === "BT_K" ? "TVOED_K" : sector === "BT_B" ? "TVOED_B" : null;
}

export function standbyLevels(
  family: DutyTariffFamily | null,
): readonly SpecialDuty["standbyLevel"][] {
  return family === "TVUK"
    ? ["I", "II"]
    : family === "TVOED_K"
      ? ["I", "II", "III"]
      : family
        ? ["A", "B", "C", "D"]
        : ["I", "II", "III", "A", "B", "C", "D"];
}

export const DUTY_RULE_SOURCES = {
  TVOED_K: {
    version: "2026-01-01",
    standby: "§§ 45–46 TVöD BT-K / Anlage G",
    onCall: "§ 8 Abs. 3 TVöD AT",
  },
  TVOED_B: {
    version: "2026-01-01",
    standby: "§§ 45–46 TVöD BT-B / Anlage G",
    onCall: "§ 8 Abs. 3 TVöD AT",
  },
  TVL_43: {
    version: "2026-02-14",
    standby: "§ 43 Nr. 5 TV-L / Anlage E",
    onCall: "§ 8 Abs. 5 TV-L",
  },
  TVH_43: {
    version: "2026-03-27",
    standby: "§ 43 Nr. 5 TV-H / Anlage D",
    onCall: "§ 8 Abs. 5 TV-H",
  },
  TVUK: { version: "2025-01-01", standby: "§ 12 Abs. 1 TV-UK", onCall: "§ 12 Abs. 2 TV-UK" },
} as const;

/** Normal case only. These are entgelt factors, NEVER the legal working-time factor. */
export function standbyNormalFactor(input: {
  readonly family: DutyTariffFamily;
  readonly level: SpecialDuty["standbyLevel"];
  readonly ordinal: number | null;
  readonly normalCaseConfirmed: boolean;
  readonly date: string;
}): number | null {
  if (
    !input.normalCaseConfirmed ||
    input.date < DUTY_RULE_SOURCES[input.family].version ||
    input.date > "2026-12-31"
  )
    return null;
  if (input.family === "TVUK") return input.level === "I" ? 0.7 : input.level === "II" ? 0.9 : null;
  if (input.family === "TVOED_K")
    return input.level === "I"
      ? 0.6
      : input.level === "II"
        ? 0.75
        : input.level === "III"
          ? 0.9
          : null;
  if (
    input.ordinal === null ||
    !Number.isInteger(input.ordinal) ||
    input.ordinal < 1 ||
    input.ordinal > 100
  )
    return null;
  const base = { A: 15, B: 25, C: 40, D: 55 }[input.level as "A" | "B" | "C" | "D"];
  if (base === undefined) return null;
  return (base + (input.ordinal <= 8 ? 25 : input.ordinal <= 12 ? 35 : 45)) / 100;
}

/** One uninterrupted duty <=24h. Caller must resolve the start day's holiday and table rate. */
export function onCallBaseHours(
  family: DutyTariffFamily,
  actualMinutes: number,
  weekendOrHoliday: boolean,
): number | null {
  if (!Number.isFinite(actualMinutes) || actualMinutes <= 0 || actualMinutes > 1440) return null;
  if (family === "TVUK") return (actualMinutes / 60) * 0.125;
  if (actualMinutes >= 720) return weekendOrHoliday ? 4 : 2;
  return (
    (family === "TVL_43" || family === "TVH_43"
      ? Math.ceil(actualMinutes / 60)
      : actualMinutes / 60) * 0.125
  );
}

/** Inputs include actual travel. Returns monetary time only; never overwrites recorded time. */
export function onCallPaidMinutes(
  family: DutyTariffFamily,
  onsite: readonly number[],
  remote: readonly number[],
): number {
  if ([...onsite, ...remote].some((value) => !Number.isInteger(value) || value < 0 || value > 1440))
    throw new Error("Ungültige Einsatzdauer.");
  const round = (minutes: number, step: number) => Math.ceil(minutes / step) * step;
  const remoteTotal = remote.reduce((sum, minutes) => sum + minutes, 0);
  if (family === "TVUK") {
    const external = onsite.reduce((sum, minutes) => sum + minutes, 0);
    return remoteTotal + external + (onsite.length ? Math.max(0, 180 - Math.min(...onsite)) : 0);
  }
  return (
    onsite.reduce((sum, minutes) => sum + round(minutes, 60), 0) +
    round(remoteTotal, family === "TVL_43" || family === "TVH_43" ? 30 : 60)
  );
}
