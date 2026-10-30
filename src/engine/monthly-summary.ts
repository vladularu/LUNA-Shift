import { projectDutyCalendarDays } from "./special-duty";
import { specialDutyTimeAccount } from "./special-duty-time-account";
import type {
  MonthlySummary,
  MonthlySummaryCategory,
  ShiftEntry,
  UserProfile,
} from "@/domain/types";
import type {
  MonthlyWorkingTimeTarget,
  WorkingTimeTargetContext,
  WorkingTimeTargetProfile,
} from "@/domain/working-time-target";
import {
  calculateMonthlyWorkingTimeTarget,
  calculateMonthlyWorkingTimeTargetSteps,
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
  profile: WorkingTimeTargetProfile,
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
  profile: WorkingTimeTargetProfile & Pick<UserProfile, "timeZone">,
  ruleResolver: RuleResolver = bundledRuleResolver,
  targetContext?: WorkingTimeTargetContext,
): MonthlySummary & { readonly targetCalculation?: MonthlyWorkingTimeTarget } {
  const steps = calculateMonthlySummarySteps(month, entries, profile, ruleResolver, targetContext);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* calculateMonthlySummarySteps(
  month: string,
  entries: readonly ShiftEntry[],
  profile: WorkingTimeTargetProfile & Pick<UserProfile, "timeZone">,
  ruleResolver: RuleResolver = bundledRuleResolver,
  targetContext?: WorkingTimeTargetContext,
): Generator<
  number,
  MonthlySummary & { readonly targetCalculation?: MonthlyWorkingTimeTarget },
  void
> {
  const account = specialDutyTimeAccount(month, entries, profile, ruleResolver);
  const specialDutyNotes = account.notes;
  entries = projectDutyCalendarDays(entries);
  const work = category();
  const training = category();
  const vacation = category();
  const sick = category();
  const free = category();
  const entriesByDate = new Map<string, ShiftEntry[]>();
  const counted = new Set<string>();

  for (const entry of entries) {
    if (!entry.date.startsWith(`${month}-`) || entry.deletedAt !== null) {
      continue;
    }

    const dayEntries = entriesByDate.get(entry.date) ?? [];
    dayEntries.push(entry);
    entriesByDate.set(entry.date, dayEntries);
    if (counted.has(entry.id)) continue;
    counted.add(entry.id);
    if (entry.type === "FREE") free.entryCount += 1;
    else if (entry.type === "VACATION") vacation.entryCount += 1;
    else if (entry.type === "SICK") sick.entryCount += 1;
    else if (entry.type === "TRAINING") training.entryCount += 1;
    else work.entryCount += 1;
  }

  let overlapMinutes = 0;
  let ordinaryMinutes = 0;
  for (const [date, dayEntries] of entriesByDate) {
    const day = calculateDailyWorkCredit(date, dayEntries, profile, ruleResolver);
    work.minutes += day.workMinutes;
    training.minutes += day.trainingMinutes;
    vacation.minutes += day.vacationMinutes;
    sick.minutes += day.sickMinutes;
    overlapMinutes += day.overlapMinutes;
    ordinaryMinutes += dayEntries.some((entry) => account.ids.has(entry.id))
      ? calculateDailyWorkCredit(
          date,
          dayEntries.filter((entry) => !account.ids.has(entry.id)),
          profile,
          ruleResolver,
        ).actualMinutes
      : day.actualMinutes;
    yield 1;
  }

  const actualMinutes = work.minutes + training.minutes + vacation.minutes + sick.minutes;
  const targetCalculation = yield* calculateMonthlyWorkingTimeTargetSteps(
    month,
    profile,
    ruleResolver,
    targetContext,
  );
  const targetMinutes = requireTargetMinutes(targetCalculation);
  const timeAccountMinutes =
    account.creditedMinutes === null ? null : ordinaryMinutes + account.creditedMinutes;

  return Object.freeze({
    month,
    ...(specialDutyNotes.length ? { specialDutyNotes } : {}),
    ...(account.lines.length ? { timeAccountMinutes, specialDutyTimeCredits: account.lines } : {}),
    targetMinutes,
    ...(targetContext === undefined && !profile.workingTimeTarget ? {} : { targetCalculation }),
    actualMinutes,
    balanceMinutes: (timeAccountMinutes ?? actualMinutes) - targetMinutes,
    overlapMinutes,
    work: freezeCategory(work),
    training: freezeCategory(training),
    vacation: freezeCategory(vacation),
    sick: freezeCategory(sick),
    free: freezeCategory(free),
  });
}
