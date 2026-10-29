import type { UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { getIndividualHourlyRate } from "./tariff";
import { getVkaEDutyHourlyCents } from "./simple-vka-e-pay";
import { getTrainingDutyHourlyCents } from "./simple-nursing-training-pay";
import { getTvlDutyHourlyCents } from "./simple-tvl-kr-pay";
import { getTvhDutyHourlyCents } from "./simple-tvh-kr-pay";
import { getTvUkDutyHourlyCents } from "./simple-tvuk-nursing-pay";
import { getTvalDutyHourlyCents } from "./simple-tval-pflege-pay";

export function specialDutyHourlyCents(date: string, profile: UserProfile, resolver: RuleResolver) {
  if (profile.salaryBasisConflict || profile.manualMonthlyGrossCents != null) return null;
  const selected = [
    profile.tariff,
    profile.vkaETariff,
    profile.nursingTrainingTariff,
    profile.tvlKrTariff,
    profile.tvhKrTariff,
    profile.tvUkNursingTariff,
    profile.tvalPflegeTariff,
  ];
  if (selected.filter(Boolean).length !== 1) return null;
  if (profile.tariff) {
    const value = getIndividualHourlyRate(profile.tariff, date, resolver);
    return value === null ? null : Math.round(value * 100);
  }
  if (profile.vkaETariff) return getVkaEDutyHourlyCents(date, profile, resolver);
  if (profile.nursingTrainingTariff) return getTrainingDutyHourlyCents(date, profile, resolver);
  if (profile.tvlKrTariff) return getTvlDutyHourlyCents(date, profile, resolver);
  if (profile.tvhKrTariff) return getTvhDutyHourlyCents(date, profile, resolver);
  if (profile.tvUkNursingTariff) return getTvUkDutyHourlyCents(date, profile, resolver);
  return getTvalDutyHourlyCents(date, profile, resolver);
}
