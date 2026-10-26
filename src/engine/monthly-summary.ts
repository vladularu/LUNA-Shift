import type {
  MonthlySummary,
  MonthlySummaryCategory,
  ShiftEntry,
  UserProfile,
} from "@/domain/types";
import type {
  MonthlyWorkingTimeTarget,
  WorkingTimeTargetContext,
} from "@/domain/working-time-target";
import {
  calculateMonthlyWorkingTimeTarget,
  requireTargetMinutes,
} from "@/engine/working-time-target";
import { calculateDailyWorkCredit } from "@/engine/daily-summary";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";

function category(): { minutes: number; entryCount: number } {
  return { minutes: 0, entryCount: 0 };
}

function freezeCategory(value: MonthlySummaryCategory): MonthlySummaryCategory {
  return Object.freeze({ ...value });
}

export function calculateMonthlyTargetMinutes(
  month: string,
  profile: Pick<UserProfile, "federalState" | "weeklyMinutes"> &
    Partial<Pick<UserProfile, "holidayRegion">>,
  ruleResolver: RuleResolver = bundledRuleResolver,
  targetContext?: WorkingTimeTargetContext,
): number {
  return requireTargetMinutes(
    calculateMonthlyWorkingTimeTarget(month, profile, ruleResolver, targetContext),
  );
}

export function calculateMonthlySummary(
  month: string,
  entries: readonly ShiftEntry[],
  profile: Pick<UserProfile, "federalState" | "weeklyMinutes" | "timeZone"> &
    Partial<Pick<UserProfile, "holidayRegion">>,
  ruleResolver: RuleResolver = bundledRuleResolver,
  targetContext?: WorkingTimeTargetContext,
): MonthlySummary & { readonly targetCalculation?: MonthlyWorkingTimeTarget } {
  const work = category();
  const training = category();
  const vacation = category();
  const sick = category();
  const free = category();
  const entriesByDate = new Map<string, ShiftEntry[]>();

  for (const entry of entries) {
    if (!entry.date.startsWith(`${month}-`) || entry.deletedAt !== null) {
      continue;
    }

    const dayEntries = entriesByDate.get(entry.date) ?? [];
    dayEntries.push(entry);
    entriesByDate.set(entry.date, dayEntries);
    if (entry.type === "FREE") free.entryCount += 1;
    else if (entry.type === "VACATION") vacation.entryCount += 1;
    else if (entry.type === "SICK") sick.entryCount += 1;
    else if (entry.type === "TRAINING") training.entryCount += 1;
    else work.entryCount += 1;
  }

  let overlapMinutes = 0;
  for (const [date, dayEntries] of entriesByDate) {
    const day = calculateDailyWorkCredit(date, dayEntries, profile, ruleResolver);
    work.minutes += day.workMinutes;
    training.minutes += day.trainingMinutes;
    vacation.minutes += day.vacationMinutes;
    sick.minutes += day.sickMinutes;
    overlapMinutes += day.overlapMinutes;
  }

  const actualMinutes = work.minutes + training.minutes + vacation.minutes + sick.minutes;
  const targetCalculation = calculateMonthlyWorkingTimeTarget(
    month,
    profile,
    ruleResolver,
    targetContext,
  );
  const targetMinutes = requireTargetMinutes(targetCalculation);

  return Object.freeze({
    month,
    targetMinutes,
    ...(targetContext === undefined ? {} : { targetCalculation }),
    actualMinutes,
    balanceMinutes: actualMinutes - targetMinutes,
    overlapMinutes,
    work: freezeCategory(work),
    training: freezeCategory(training),
    vacation: freezeCategory(vacation),
    sick: freezeCategory(sick),
    free: freezeCategory(free),
  });
}
