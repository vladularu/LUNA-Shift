import { payrollEmploymentPeriods } from "@/engine/payroll-employment-periods";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import {
  saveTvoedWorkPatternSettings,
  loadTvoedWorkPatternSettings,
} from "./preferences-repository";
import {
  employmentWorkPatternAt,
  employmentProfileAt,
  employmentDataFromProfile,
  employmentTimelineKey,
  encodeEmploymentPayload,
  decodeEmploymentPayload,
} from "@/domain/employment-history";
import { resolver as allowanceResolver, shift } from "@/engine/remuneration-test-fixtures";
import { deriveDatedAllowanceAssessments } from "@/engine/remuneration-assessment";
import { VKA_E_PREFERENCE_KEY } from "@/domain/vka-e-tariff";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase, LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import { saveProfile, loadProfile } from "./profile-repository";
import { saveEmploymentProfile } from "./employment-profile-repository";
import {
  listRemunerationProfiles,
  saveDatedRemunerationProfile,
} from "./remuneration-profile-repository";
import { projectStoredSimpleProfile } from "./simple-app-profile";
import type { UserProfile, SaveProfileInput } from "@/domain/types";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { loadLocalBackupSnapshot, createLocalBackupDocument } from "./local-backup";
import { validateLocalBackup } from "./local-backup-validation";
import { restoreLocalBackup } from "./local-backup-restore";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { createHash } from "node:crypto";
class MemoryDatabase {
  readonly raw = new Database(":memory:");
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...params: unknown[]) {
    const result = this.raw.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get db() {
    return this as unknown as SQLiteDatabase;
  }
}
const input = {
  federalState: "HE" as const,
  weeklyMinutes: 2310,
  timeZone: "Europe/Berlin",
  displayName: "Synthetic",
  employerName: "Synthetic employer",
  tariff: {
    payGroup: "P8" as const,
    payLevel: 4 as const,
    sector: "BT_K" as const,
    tariffRegion: "OTHER" as const,
    fullTimeWeeklyMinutes: 2310,
  },
};

let memory: MemoryDatabase;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
  memory = new MemoryDatabase();
  await migrateDatabase(memory.db);
  await saveProfile(memory.db, {
    ...input,
    regularRotatingNightWork: true,
    sundayHolidayWorkEligible: true,
    allEmploymentWorkRecorded: true,
  });
});
afterEach(() => {
  memory.raw.close();
  vi.useRealTimers();
});
async function current(): Promise<UserProfile> {
  const profile = (await projectStoredSimpleProfile(memory.db, await loadProfile(memory.db)))!;
  return { ...profile, employmentTimeline: await listRemunerationProfiles(memory.db) };
}
async function edit(date: string | null, change: Partial<SaveProfileInput>, base?: UserProfile) {
  const p = base ?? (await current());
  return saveEmploymentProfile(memory.db, {
    ...p,
    ...change,
    validity: {
      effectiveFrom: date,
      expectedProfileUpdatedAt: p.updatedAt,
      expectedTimeline: employmentTimelineKey(p.employmentTimeline ?? []),
    },
  });
}
const pay = (p: UserProfile, month: string) => calculateMonthlyPayEstimate(month, [], p, null);
const target = (p: UserProfile, month: string) =>
  calculateMonthlyWorkingTimeTarget(
    month,
    createWorkingTimeCalculationProfile(p, null, p.employmentTimeline ?? []),
  ).targetMinutes;

describe("existing profile settings with validity", () => {
  it("preserves all older salary and target inputs when hours change in July", async () => {
    const old = await current();
    const junePay = pay(old, "2026-06").personalBaseAmount;
    const saved = await edit("2026-07-01", { weeklyMinutes: 1155 });
    expect(employmentProfileAt(saved, "2026-06-30").weeklyMinutes).toBe(2310);
    expect(pay(saved, "2026-06").personalBaseAmount).toBe(junePay);
    expect(pay(saved, "2026-07").personalBaseAmount).toBeCloseTo(junePay! / 2, 2);
    expect(target(saved, "2026-12")).toBe(4389);
  });
  it("keeps December 146:18 independently of worked days and without new setup", async () => {
    const saved = await edit(null, { regularRotatingNightWork: false });
    expect(target(saved, "2026-12")).toBe(8778);
  });
  it("uses the old five-day answer until its dated change", async () => {
    await saveProfile(memory.db, { ...input, sundayHolidayWorkEligible: false });
    const p = await edit("2027-01-01", { sundayHolidayWorkEligible: true });
    expect(target(p, "2026-12")).toBe(9240);
    expect(employmentProfileAt(p, "2027-01-01").sundayHolidayWorkEligible).toBe(true);
  });
  it("does not activate a future step early, including after reload", async () => {
    const p = await edit("2027-01-01", { tariff: { ...input.tariff, payLevel: 5 } });
    expect(p.tariff?.payLevel).toBe(4);
    expect((await current()).tariff?.payLevel).toBe(4);
    expect(employmentProfileAt(p, "2027-01-01").tariff?.payLevel).toBe(5);
  });
  it("carries hours into an existing future step without removing that step", async () => {
    await edit("2027-01-01", { tariff: { ...input.tariff, payLevel: 5 } });
    const p = await edit("2026-11-01", { weeklyMinutes: 1800 });
    expect(employmentProfileAt(p, "2027-01-01")).toMatchObject({
      weeklyMinutes: 1800,
      tariff: { payLevel: 5 },
    });
  });
  it("retains an explicitly planned later hours change", async () => {
    await edit("2027-01-01", { weeklyMinutes: 1200 });
    const p = await edit("2026-11-01", { weeklyMinutes: 1800 });
    expect(employmentProfileAt(p, "2027-01-01").weeklyMinutes).toBe(1200);
  });
  it("rejects a stale form atomically", async () => {
    const p = await current();
    await edit("2026-11-01", { weeklyMinutes: 1800 }, p);
    const before = await listRemunerationProfiles(memory.db);
    await expect(edit("2026-12-01", { weeklyMinutes: 1200 }, p)).rejects.toThrow("inzwischen");
    expect(await listRemunerationProfiles(memory.db)).toEqual(before);
  });
  it("keeps regional holiday inputs before a move", async () => {
    const p = await edit("2026-11-01", { federalState: "NW", holidayRegion: "NONE" });
    expect(employmentProfileAt(p, "2026-10-31").federalState).toBe("HE");
    expect(employmentProfileAt(p, "2026-11-01").federalState).toBe("NW");
  });
  it("prorates a mid-month TVoed step from documented monthly amounts", async () => {
    const before = await current();
    const amount = pay(before, "2026-10").personalBaseAmount!;
    const higher = pay(
      { ...before, tariff: { ...input.tariff, payLevel: 5 } },
      "2026-10",
    ).personalBaseAmount!;
    const p = await edit("2026-10-16", { tariff: { ...input.tariff, payLevel: 5 } });
    expect(pay(p, "2026-10").personalBaseAmount).toBeCloseTo(
      Math.round(((amount * 15) / 31) * 100) / 100 + Math.round(((higher * 16) / 31) * 100) / 100,
    );
  });
  it("preserves context when the existing advanced remuneration editor changes a step", async () => {
    await edit("2026-07-01", { weeklyMinutes: 1800 });
    const list = await listRemunerationProfiles(memory.db);
    const data = list.at(-1)!.data;
    if (data.selection.kind !== "tariff") throw new Error("fixture");
    await saveDatedRemunerationProfile(memory.db, {
      effectiveFrom: "2026-11-01",
      expectedRevision: 0,
      data: { ...data, selection: { ...data.selection, level: "5" } },
    });
    expect(employmentProfileAt(await current(), "2026-11-01")).toMatchObject({
      weeklyMinutes: 1800,
      sundayHolidayWorkEligible: true,
      tariff: { payLevel: 5 },
    });
  });
  it("round trips dated inputs through the existing backup without schema changes", async () => {
    const p = await edit("2026-07-01", { weeklyMinutes: 1155 });
    const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
    const document = await createLocalBackupDocument(await loadLocalBackupSnapshot(memory.db), {
      appVersion: "synthetic",
      createdAt: new Date(),
      sha256,
    });
    const validated = await validateLocalBackup(document.serialized, {
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    });
    await restoreLocalBackup(memory.db, validated);
    expect((await current()).employmentTimeline).toEqual(p.employmentTimeline);
  });
  it.each<Partial<SaveProfileInput>>([
    { tariff: null, manualMonthlyGrossCents: 300000 },
    { tariff: { ...input.tariff, sector: "BT_B", fullTimeWeeklyMinutes: 2340 } },
    {
      tariff: null,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
    { tariff: null, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
    { tariff: null, tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 } },
    { tariff: null, tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
    {
      tariff: null,
      nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
    },
    { tariff: null, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } },
  ])("preserves older salary profiles for each selectable family: %j", async (salary) => {
    await saveProfile(memory.db, { ...input, ...salary });
    const before = await current();
    const amount = pay(before, "2026-06").personalBaseAmount;
    expect(amount).not.toBeNull();
    const saved = await edit("2026-07-01", { weeklyMinutes: 1155 });
    expect(pay(saved, "2026-06").personalBaseAmount).toBe(amount);
    expect(employmentProfileAt(saved, "2026-06-30")).toMatchObject(salary);
    expect(employmentProfileAt(saved, "2026-07-01").weeklyMinutes).toBe(1155);
  });
  it("keeps past legal input facts and cross-period rest windows", async () => {
    const old = await current();
    const sunday = shift({ date: "2026-10-04", startTime: "08:00", endTime: "16:00", type: "DAY" });
    const saved = await edit("2026-11-01", {
      sundayHolidayWorkEligible: false,
      allEmploymentWorkRecorded: false,
    });
    const options = {
      employmentProfile: saved,
      federalState: saved.federalState,
      sundayHolidayWorkEligible: saved.sundayHolidayWorkEligible,
      allEmploymentWorkRecorded: saved.allEmploymentWorkRecorded,
      referenceDate: "2026-12-31",
    };
    const previous = calculateMonthlyCompliance("2026-10", [sunday], old.timeZone, {
      ...options,
      employmentProfile: old,
      sundayHolidayWorkEligible: true,
      allEmploymentWorkRecorded: true,
    });
    expect(calculateMonthlyCompliance("2026-10", [sunday], saved.timeZone, options)).toEqual(
      previous,
    );
    const crossing = [
      shift({
        id: "before",
        date: "2026-10-31",
        startTime: "18:00",
        endTime: "23:00",
        type: "DAY",
      }),
      shift({ id: "after", date: "2026-11-01", startTime: "05:00", endTime: "13:00", type: "DAY" }),
    ];
    expect(
      calculateMonthlyCompliance("2026-11", crossing, saved.timeZone, options).issues.some(
        (i) => i.rule === "ARBZG_5_REST_10H",
      ),
    ).toBe(true);
  });
  it("does not rewrite the baseline when an unchanged form is saved", async () => {
    const p = await current();
    await edit("2026-12-01", {}, p);
    expect(await listRemunerationProfiles(memory.db)).toEqual([]);
  });
  it("corrects an old value already used today only in the explicit form scope", async () => {
    await edit("2026-07-01", { weeklyMinutes: 1155 });
    const p = await current();
    const saved = await saveEmploymentProfile(memory.db, {
      ...p,
      validity: {
        effectiveFrom: null,
        expectedProfileUpdatedAt: p.updatedAt,
        expectedTimeline: employmentTimelineKey(p.employmentTimeline!),
        correctionFields: ["weeklyMinutes"],
      },
    });
    expect(employmentProfileAt(saved, "2026-06-01").weeklyMinutes).toBe(1155);
    expect(employmentProfileAt(saved, "2026-06-01").tariff).toEqual(input.tariff);
  });
  it("keeps a newly effective planned step when a stale work form edits only hours", async () => {
    const stale = await edit("2026-11-01", { tariff: { ...input.tariff, payLevel: 5 } });
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    const saved = await saveEmploymentProfile(memory.db, {
      ...stale,
      weeklyMinutes: 1800,
      validity: {
        effectiveFrom: "2026-12-01",
        expectedProfileUpdatedAt: stale.updatedAt,
        expectedTimeline: employmentTimelineKey(stale.employmentTimeline!),
        fields: ["weeklyMinutes", "federalState", "holidayRegion"],
        baseline: employmentDataFromProfile(stale),
      },
    });
    expect(saved).toMatchObject({ weeklyMinutes: 1800, tariff: { payLevel: 5 } });
  });
  it("keeps a newly effective hours change when a stale work form edits only the location", async () => {
    const stale = await edit("2026-11-01", { weeklyMinutes: 1800 });
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    const saved = await saveEmploymentProfile(memory.db, {
      ...stale,
      federalState: "NW",
      validity: {
        effectiveFrom: "2026-12-01",
        expectedProfileUpdatedAt: stale.updatedAt,
        expectedTimeline: employmentTimelineKey(stale.employmentTimeline!),
        fields: ["weeklyMinutes", "federalState", "holidayRegion"],
        baseline: employmentDataFromProfile(stale),
      },
    });
    expect(saved).toMatchObject({ weeklyMinutes: 1800, federalState: "NW" });
  });
  it("retains a newly missing check prerequisite after a mid-month change", async () => {
    const saved = await edit("2026-10-15", { allEmploymentWorkRecorded: false });
    const entries = [
      shift({ id: "first", date: "2026-10-01" }),
      shift({ id: "second", date: "2026-10-20" }),
    ];
    const result = calculateMonthlyCompliance("2026-10", entries, saved.timeZone, {
      employmentProfile: saved,
    });
    expect(
      result.issues.some((i) => i.rule === "ARBZG_DATA_ALL_EMPLOYMENT" && i.date === "2026-10-20"),
    ).toBe(true);
  });
  it("resolves a pre-existing salary conflict through the same existing dated form", async () => {
    memory.raw
      .prepare("INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?)")
      .run(
        VKA_E_PREFERENCE_KEY,
        JSON.stringify({ payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" }),
        new Date().toISOString(),
      );
    expect((await current()).salaryBasisConflict).toBeDefined();
    const saved = await edit(null, { tariff: input.tariff, manualMonthlyGrossCents: null });
    expect(saved.salaryBasisConflict).toBeUndefined();
    expect(saved.tariff).toEqual(input.tariff);
  });
  it("reads old financial payloads and refuses newer or inconsistent employment payloads", async () => {
    const p = await edit("2026-07-01", { weeklyMinutes: 1155 });
    const entry = p.employmentTimeline!.at(-1)!;
    expect(decodeEmploymentPayload(entry.data).data).toEqual(entry.data);
    expect(() =>
      decodeEmploymentPayload({
        ...JSON.parse(encodeEmploymentPayload(entry.data, entry.employment)),
        profileVersion: 99,
      }),
    ).toThrow();
    expect(() =>
      encodeEmploymentPayload({ ...entry.data, weeklyMinutes: 1000 }, entry.employment),
    ).toThrow();
  });
});

describe("dated shift-model answers in the existing employment timeline", () => {
  const around = { workplaceCoverage: "AROUND_THE_CLOCK", assignment: "PERMANENT" } as const;
  const daytime = { workplaceCoverage: "NOT_AROUND_THE_CLOCK", assignment: "TEMPORARY" } as const;
  const fallback = { ...around, updatedAt: null };
  it("captures legacy answers and changes only from the selected day after a reload", async () => {
    await saveTvoedWorkPatternSettings(memory.db, around);
    await edit("2026-07-16", { workPattern: daytime });
    const reloaded = await current();
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-07-15")).toMatchObject(around);
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-07-16")).toMatchObject(daytime);
    expect(reloaded.workPattern).toEqual(daytime);
    expect(await loadTvoedWorkPatternSettings(memory.db)).toMatchObject(around);
    expect(reloaded.weeklyMinutes).toBe(2310);
    expect(target(reloaded, "2026-12")).toBe(8778);
  });
  it("keeps future shift-model changes out of today's profile and retains later hours", async () => {
    await saveTvoedWorkPatternSettings(memory.db, around);
    await edit("2027-02-01", { weeklyMinutes: 1800 });
    await edit("2026-12-01", { workPattern: daytime });
    const reloaded = await current();
    expect(reloaded.workPattern).toEqual(around);
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-12-01")).toMatchObject(daytime);
    expect(employmentProfileAt(reloaded, "2027-02-01").weeklyMinutes).toBe(1800);
    expect(employmentProfileAt(reloaded, "2027-02-01").workPattern).toEqual(daytime);
  });
  it("keeps a planned later shift-model change during a baseline correction", async () => {
    await saveTvoedWorkPatternSettings(memory.db, around);
    await edit("2026-12-01", { workPattern: daytime });
    await edit(null, { workPattern: { ...around, assignment: "UNKNOWN" } });
    const reloaded = await current();
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-06-01")).toMatchObject({
      ...around,
      assignment: "UNKNOWN",
    });
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-12-01")).toMatchObject(daytime);
  });
  it("keeps the earlier allowance assessment and splits a change within the month", async () => {
    await edit("2026-01-01", { workPattern: around });
    const shifts = ["01", "02", "03", "17", "18", "19"].map((day, index) =>
      shift({
        id: day,
        date: "2026-07-" + day,
        startTime: index % 2 ? "14:00" : "06:00",
        endTime: index % 2 ? "22:00" : "14:00",
      }),
    );
    const june = shifts.map((item) => ({ ...item, date: item.date.replace("2026-07", "2026-06") }));
    const before = calculateMonthlyPayEstimate(
      "2026-06",
      june,
      await current(),
      null,
      june,
      fallback,
    );
    expect(before.allowanceAmount).toBeGreaterThan(0);
    const saved = await edit("2026-07-16", { workPattern: daytime });
    expect(calculateMonthlyPayEstimate("2026-06", june, saved, null, june, fallback)).toEqual(
      before,
    );
    const result = deriveDatedAllowanceAssessments({
      month: "2026-07",
      shifts,
      workProfile: saved,
      history: saved.employmentTimeline!,
      settings: fallback,
      resolver: allowanceResolver(),
    });
    expect(result.periods.map((p) => [p.from, p.through])).toEqual([
      ["2026-07-01", "2026-07-15"],
      ["2026-07-16", "2026-07-31"],
    ]);
    expect(result.periods.map((p) => p.issue)).toEqual([null, null]);
    expect(result.periods[0].assessment?.suggestedAllowance).toBe("SHIFT_MONTHLY");
    expect(result.periods[1].assessment?.suggestedAllowance).toBe("SHIFT_HOURLY");
  });
  it("retains dated shift answers in a strict backup and restore roundtrip", async () => {
    await saveTvoedWorkPatternSettings(memory.db, around);
    await edit("2026-07-16", { workPattern: daytime });
    const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
    const document = await createLocalBackupDocument(await loadLocalBackupSnapshot(memory.db), {
      appVersion: "synthetic",
      createdAt: new Date(),
      sha256,
    });
    const checked = await validateLocalBackup(document.serialized, {
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    });
    await restoreLocalBackup(memory.db, checked);
    const reloaded = await current();
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-07-15")).toMatchObject(around);
    expect(employmentWorkPatternAt(reloaded, fallback, "2026-07-16")).toMatchObject(daytime);
  });
  it("reads the earlier 16-field payload and rejects invalid shift answers", async () => {
    const p = await edit(null, { weeklyMinutes: 1800 });
    const employment = employmentDataFromProfile(p);
    const legacy = Object.fromEntries(
      Object.entries(employment).filter(([key]) => key !== "workPattern"),
    );
    const data = p.employmentTimeline![0].data;
    expect(
      decodeEmploymentPayload({ profileVersion: 1, data, employment: legacy }).employment
        ?.workPattern,
    ).toBeNull();
    expect(() =>
      decodeEmploymentPayload({
        profileVersion: 2,
        data,
        employment: {
          ...legacy,
          workPattern: { workplaceCoverage: "INVALID", assignment: "PERMANENT" },
        },
      }),
    ).toThrow(/Schichtmodell/);
  });
});

describe("explicit whole-period correction", () => {
  async function correct(change: Partial<SaveProfileInput>, fields: readonly string[]) {
    const p = await current();
    return saveEmploymentProfile(memory.db, {
      ...p,
      ...change,
      validity: {
        effectiveFrom: null,
        expectedProfileUpdatedAt: p.updatedAt,
        expectedTimeline: employmentTimelineKey(p.employmentTimeline ?? []),
        baseline: employmentDataFromProfile(p),
        fields,
        correctionFields: fields,
      },
    });
  }
  it("uses corrected hours with existing legacy target periods after reload", async () => {
    await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    const p = await current();
    const calculation = createWorkingTimeCalculationProfile(
      p,
      {
        saved: null,
        context: decemberTargetContext,
        staleDates: [],
        planRevision: "plan",
      },
      p.employmentTimeline!,
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6840);
    expect(p.employmentTimeline![0].employmentOverrides).toHaveProperty(
      "weeklyMinutes",
      "2026-10-25",
    );
  });
  it("repairs an already saved but masked correction without changing the hours again", async () => {
    await edit(null, { weeklyMinutes: 1800 });
    const p = await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    const calculation = createWorkingTimeCalculationProfile(
      p,
      { saved: null, context: decemberTargetContext, staleDates: [], planRevision: "plan" },
      p.employmentTimeline!,
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6840);
  });
  it("persists whole-period authority through a later salary entry and backup restore", async () => {
    const p = await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    const data = p.employmentTimeline![0].data;
    if (data.selection.kind !== "tariff") throw Error("Expected fixture tariff");
    await saveDatedRemunerationProfile(memory.db, {
      effectiveFrom: "2026-11-01",
      expectedRevision: 0,
      data: { ...data, selection: { ...data.selection, level: "5" } },
    });
    const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
    const document = await createLocalBackupDocument(await loadLocalBackupSnapshot(memory.db), {
      appVersion: "synthetic",
      createdAt: new Date(),
      sha256,
    });
    const checked = await validateLocalBackup(document.serialized, {
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    });
    await restoreLocalBackup(memory.db, checked);
    const restored = await current();
    expect(
      restored.employmentTimeline!.every((row) => Boolean(row.employmentOverrides?.weeklyMinutes)),
    ).toBe(true);
    const calculation = createWorkingTimeCalculationProfile(
      restored,
      { saved: null, context: decemberTargetContext, staleDates: [], planRevision: "plan" },
      restored.employmentTimeline!,
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6840);
  });
  it("rejects unknown correction fields in the versioned payload", async () => {
    const p = await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    const row = p.employmentTimeline![0];
    const encoded = JSON.parse(
      encodeEmploymentPayload(row.data, row.employment, row.employmentOverrides),
    );
    expect(encoded.profileVersion).toBe(3);
    expect(() =>
      decodeEmploymentPayload({
        ...encoded,
        employmentOverrides: { "invented-entitlement": "2026-10-25" },
      }),
    ).toThrow(/Zeitraumkorrektur/);
    expect(() =>
      decodeEmploymentPayload({
        ...encoded,
        employmentOverrides: { weeklyMinutes: "2026-02-31" },
      }),
    ).toThrow();
  });
  it("records an explicitly chosen date even when the visible hours have not changed", async () => {
    await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    const p = await current();
    const saved = await saveEmploymentProfile(memory.db, {
      ...p,
      validity: {
        effectiveFrom: "2026-12-01",
        declarePeriod: true,
        expectedProfileUpdatedAt: p.updatedAt,
        expectedTimeline: employmentTimelineKey(p.employmentTimeline!),
        baseline: employmentDataFromProfile(p),
        fields: ["weeklyMinutes"],
      },
    });
    expect(saved.employmentTimeline!.some((row) => row.effectiveFrom === "2026-12-01")).toBe(true);
    const old = decemberTargetContext.periods[0];
    const snapshot = {
      saved: null,
      context: {
        ...decemberTargetContext,
        periods: [
          { ...old, validFrom: "2026-01-01", validTo: "2026-11-30" },
          { ...old, validFrom: "2026-12-01", validTo: null, weeklyMinutes: 2100 },
        ],
      },
      staleDates: [],
      planRevision: "plan",
    };
    const calculation = createWorkingTimeCalculationProfile(
      saved,
      snapshot,
      saved.employmentTimeline!,
    );
    expect(calculateMonthlyWorkingTimeTarget("2026-12", calculation).targetMinutes).toBe(6840);
  });
  it("corrects differing historical rows while preserving an explicit later change", async () => {
    await edit("2026-04-01", { weeklyMinutes: 1200 });
    await edit("2027-01-01", { weeklyMinutes: 2100 });
    const p = await correct({ weeklyMinutes: 1800 }, ["weeklyMinutes"]);
    expect(employmentProfileAt(p, "2026-01-01").weeklyMinutes).toBe(1800);
    expect(employmentProfileAt(p, "2026-06-01").weeklyMinutes).toBe(1800);
    expect(employmentProfileAt(p, "2026-10-25").weeklyMinutes).toBe(1800);
    expect(employmentProfileAt(p, "2027-01-01").weeklyMinutes).toBe(2100);
  });
});

describe("guarded undo of an employment save", () => {
  async function undo(before: UserProfile, saved: UserProfile) {
    return saveEmploymentProfile(memory.db, {
      ...before,
      validity: {
        effectiveFrom: null,
        baseline: employmentDataFromProfile(saved),
        restoreTimeline: before.employmentTimeline ?? [],
        expectedProfileUpdatedAt: saved.updatedAt,
        expectedTimeline: employmentTimelineKey(saved.employmentTimeline ?? []),
      },
    });
  }
  it("removes the newly created boundary and restores the original calculation inputs", async () => {
    const before = await current();
    const saved = await edit("2026-10-20", { weeklyMinutes: 1800 });
    expect(saved.employmentTimeline?.length).toBeGreaterThan(0);
    const restored = await undo(before, saved);
    expect(restored.weeklyMinutes).toBe(before.weeklyMinutes);
    expect(await listRemunerationProfiles(memory.db)).toEqual([]);
    expect((await current()).weeklyMinutes).toBe(before.weeklyMinutes);
  });
  it("restores previous content including an already planned future change", async () => {
    await edit("2027-01-01", { weeklyMinutes: 1800 });
    const before = await current();
    const saved = await edit("2026-10-20", { weeklyMinutes: 1500 });
    const restored = await undo(before, saved);
    expect(employmentProfileAt(restored, "2026-10-26").weeklyMinutes).toBe(2310);
    expect(employmentProfileAt(restored, "2027-01-01").weeklyMinutes).toBe(1800);
    expect(restored.employmentTimeline?.map((p) => p.effectiveFrom)).toEqual(
      before.employmentTimeline?.map((p) => p.effectiveFrom),
    );
    const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
    const document = await createLocalBackupDocument(await loadLocalBackupSnapshot(memory.db), {
      appVersion: "synthetic",
      createdAt: new Date(),
      sha256,
    });
    const checked = await validateLocalBackup(document.serialized, {
      maxDatabaseSchemaVersion: LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    });
    await restoreLocalBackup(memory.db, checked);
    expect(employmentProfileAt(await current(), "2027-01-01").weeklyMinutes).toBe(1800);
  });
  it("rejects undo after a later save without losing that later change", async () => {
    const before = await current();
    const saved = await edit("2026-10-20", { weeklyMinutes: 1800 });
    await edit("2027-02-01", { weeklyMinutes: 1500 });
    await expect(undo(before, saved)).rejects.toThrow("inzwischen geändert");
    expect(employmentProfileAt(await current(), "2027-02-01").weeklyMinutes).toBe(1500);
  });
});

it("corrects a mistaken middle period without erasing genuine saved dates", async () => {
  await edit("2026-10-10", { weeklyMinutes: 1800 });
  await edit("2026-10-20", { weeklyMinutes: 2310 });
  const root = await current();
  expect(payrollEmploymentPeriods(root, "2026-10", "2026-10-31")).toHaveLength(3);
  const selected = employmentProfileAt(root, "2026-10-10");
  const corrected = await saveEmploymentProfile(memory.db, {
    ...selected,
    weeklyMinutes: 2310,
    validity: {
      effectiveFrom: "2026-10-10",
      fields: ["weeklyMinutes"],
      baseline: employmentDataFromProfile(selected),
      expectedProfileUpdatedAt: root.updatedAt,
      expectedTimeline: employmentTimelineKey(root.employmentTimeline ?? []),
    },
  });
  expect(payrollEmploymentPeriods(corrected, "2026-10", "2026-10-31")).toHaveLength(1);
  expect(corrected.employmentTimeline?.map((p) => p.effectiveFrom)).toEqual(
    root.employmentTimeline?.map((p) => p.effectiveFrom),
  );
});

it("does not overwrite an independent name edit when undo timestamps coincide", async () => {
  const before = await current();
  const saved = await edit("2026-10-20", { weeklyMinutes: 1800 });
  await saveProfile(memory.db, { ...(await current()), displayName: "Independent name" });
  const restored = await saveEmploymentProfile(memory.db, {
    ...before,
    validity: {
      effectiveFrom: null,
      baseline: employmentDataFromProfile(saved),
      restoreTimeline: before.employmentTimeline ?? [],
      expectedProfileUpdatedAt: saved.updatedAt,
      expectedTimeline: employmentTimelineKey(saved.employmentTimeline ?? []),
    },
  });
  expect(restored.displayName).toBe("Independent name");
  expect(restored.weeklyMinutes).toBe(2310);
});

it("does not create or revise a redundant declaration of an already planned value", async () => {
  await edit("2027-01-01", { weeklyMinutes: 1800 });
  const before = await current();
  const saved = await saveEmploymentProfile(memory.db, {
    ...before,
    weeklyMinutes: 1800,
    validity: {
      effectiveFrom: "2027-01-01",
      fields: ["weeklyMinutes"],
      baseline: employmentDataFromProfile(before),
      expectedProfileUpdatedAt: before.updatedAt,
      expectedTimeline: employmentTimelineKey(before.employmentTimeline ?? []),
    },
  });
  expect(saved.employmentTimeline).toEqual(before.employmentTimeline);
  expect(saved.updatedAt).toBe(before.updatedAt);
});
