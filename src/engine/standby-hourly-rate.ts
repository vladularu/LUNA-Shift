import type { StandbyAgreement } from "@/domain/standby-agreement";
import type { UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { specialDutyHourlyCents } from "./special-duty-hourly-rate";
import { dutyTariffFamily } from "./special-duty-tariff";
import tables from "./standby-tables.json";

export function standbyGroupOptions(
  tariff: StandbyAgreement["tariff"],
): readonly { value: string; label: string }[] {
  if (tariff === "TVL_43" || tariff === "TVH_43")
    return Object.keys(tables.tvl).map((value) => ({
      value,
      label: `Kr. ${value.slice(3)} (Bereitschaftsgruppe)`,
    }));
  if (tariff === "TVOED_B")
    return Object.keys(tables.vka.TVOED_B)
      .filter((value) => value.startsWith("E") || value.startsWith("WORKER_"))
      .map((value) => ({
        value,
        label: value.startsWith("WORKER_")
          ? `${value.slice(7)} · Anlage G III`
          : `${value} · Anlage G I`,
      }));
  return [];
}

/** Only the employer can confirm historical classifications and training pay bases. */
export function standbyHourlyRate(
  date: string,
  profile: UserProfile,
  agreement: StandbyAgreement,
  resolver: RuleResolver,
): { cents: number; group: string; source: string } | null {
  const regular = specialDutyHourlyCents(date, profile, resolver);
  if (
    regular === null ||
    dutyTariffFamily(profile) !== agreement.tariff ||
    date < "2026-01-01" ||
    date > "2026-12-31"
  )
    return null;
  if (agreement.rateMode === "AGREED")
    return agreement.hourlyCents === null
      ? null
      : {
          cents: agreement.hourlyCents,
          group: "Vereinbarter Stundensatz",
          source: "Stundenentgelt laut Arbeitgeber, vor Bewertung",
        };
  if (agreement.tariff === "TVUK")
    return {
      cents: regular,
      group: profile.tvUkNursingTariff!.payGroup,
      source: "§ 12 Abs. 1 TV-UK",
    };
  if (profile.nursingTrainingTariff || profile.tvalPflegeTariff) return null;
  if (agreement.tariff === "TVL_43" || agreement.tariff === "TVH_43") {
    const key = agreement.payGroup;
    if (!key || !Object.hasOwn(tables.tvl, key)) return null;
    if (agreement.tariff === "TVH_43") {
      const row = tables.tvh[key as keyof typeof tables.tvh];
      return {
        cents: row[date < "2026-07-01" ? 0 : 1],
        group: `Kr. ${key.slice(3)}`,
        source: "Anlage D TV-H, 01.08.2025 / 01.07.2026",
      };
    }
    const region = profile.tvlKrTariff!.universityRegion;
    if (region !== "WEST" && region !== "EAST") return null;
    const row = tables.tvl[key as keyof typeof tables.tvl];
    return {
      cents: row[(date < "2026-04-01" ? 0 : 1) + (region === "EAST" ? 2 : 0)],
      group: `Kr. ${key.slice(3)} · ${region === "WEST" ? "West" : "Ost"}`,
      source: "Anlage E TV-L, 01.11.2025 / 01.04.2026",
    };
  }
  const group = profile.tariff?.payGroup ?? profile.vkaETariff?.payGroup;
  if (!group) return null;
  // BT-B distinguishes Anlage G I from the former workers' Anlage G III.
  const key = agreement.tariff === "TVOED_B" && profile.vkaETariff ? agreement.payGroup : group;
  if (!key || (key !== group && key !== `WORKER_${group}`)) return null;
  const table = tables.vka[agreement.tariff] as Record<string, number[]>;
  const row = Object.hasOwn(table, key) ? table[key] : null;
  return row
    ? {
        cents: row[date < "2026-05-01" ? 0 : 1],
        group: key,
        source: `Anlage G TVöD ${agreement.tariff === "TVOED_K" ? "BT-K" : "BT-B"}, 01.04.2025 / 01.05.2026`,
      }
    : null;
}
