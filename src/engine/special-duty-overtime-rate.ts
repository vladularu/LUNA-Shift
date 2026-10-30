import type { DutyOvertimeRates } from "@/domain/special-duty-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { specialDutyHourlyCents } from "./special-duty-hourly-rate";
import { getVkaEDutyOvertimeRates } from "./simple-vka-e-pay";
import { getTrainingDutyOvertimeRates } from "./simple-nursing-training-pay";
import { getTvlDutyOvertimeRates } from "./simple-tvl-kr-pay";
import { getTvhDutyOvertimeRates } from "./simple-tvh-kr-pay";
import { getTvalDutyOvertimeRates } from "./simple-tval-pflege-pay";
import {
  getTariffRulePackage,
  getHourlyTableAmountForStep,
  getOvertimeBaseHourlyRate,
} from "./tariff";
import { conditionsMatch } from "./pay-conditions";

/** Pay bases only. They do not create worked time or SFN-entitled intervals. */
export function specialDutyOvertimeRates(
  date: string,
  profile: UserProfile,
  shift: ShiftEntry,
  resolver: RuleResolver,
): DutyOvertimeRates | null {
  const hourly = specialDutyHourlyCents(date, profile, resolver);
  if (hourly === null) return null;
  if (profile.tvUkNursingTariff)
    return { baseHourlyCents: hourly, premiumHourlyCents: hourly, premiumBasisPoints: 2500 };
  if (profile.vkaETariff) return getVkaEDutyOvertimeRates(date, profile, resolver);
  if (profile.nursingTrainingTariff) return getTrainingDutyOvertimeRates(date, profile, resolver);
  if (profile.tvlKrTariff) return getTvlDutyOvertimeRates(date, profile, resolver);
  if (profile.tvhKrTariff) return getTvhDutyOvertimeRates(date, profile, resolver);
  if (profile.tvalPflegeTariff) return getTvalDutyOvertimeRates(date, profile, resolver);
  const tariff = profile.tariff;
  const pkg = getTariffRulePackage(date, resolver);
  if (!tariff || !pkg) return null;
  const rules = pkg.rules.premiumRules.filter(
    (r) =>
      r.premiumType === "OVERTIME" && conditionsMatch(r.conditions, profile, date, shift, null),
  );
  if (rules.length !== 1) return null;
  const rule = rules[0];
  const premium =
    rule.rateBasis === "INDIVIDUAL_HOURLY"
      ? hourly / 100
      : rule.referenceStepId
        ? getHourlyTableAmountForStep(tariff, date, rule.referenceStepId, resolver)
        : null;
  if (premium === null) return null;
  return {
    baseHourlyCents: Math.round(getOvertimeBaseHourlyRate(pkg, tariff, hourly / 100) * 100),
    premiumHourlyCents: Math.round(premium * 100),
    premiumBasisPoints: rule.percentageBasisPoints,
  };
}
