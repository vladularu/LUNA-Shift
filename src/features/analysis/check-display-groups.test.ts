import { describe, expect, it } from "vitest";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import { TARIFF_TIME_POLICIES } from "@/domain/tariff-time-policy";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import { checkDisplayProjection, groupCheckDisplayIssues } from "./check-display-groups";

function duty(date: string, night = false, id = date): ShiftEntry {
  return {
    kind: "SHIFT",
    id,
    date,
    templateId: null,
    title: night ? "Nacht" : "Tag",
    type: night ? "NIGHT" : "DAY",
    startTime: night ? "21:00" : "08:00",
    endTime: night ? "07:00" : "16:00",
    breakMinutes: 60,
    color: "#123456",
    symbol: "D",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
}

const entries = Array.from({ length: 6 }, (_, index) => duty(`2026-11-0${index + 2}`, index >= 2));
const following = duty("2026-11-09");
const allEntries = [...entries, following];
const nightIds = entries.slice(2).map((shift) => shift.id);
const sequence = {
  policyVersion: PLANNING_NIGHT_POLICY.version,
  firstNight: "2026-11-04",
  lastNight: "2026-11-07",
  countIsMinimum: false,
  recoveryStatus: "under48" as const,
  restMinutes: 1_500,
  lastShiftId: entries[5].id,
  nextShiftId: following.id,
};
const issue = (id: string, patch: Partial<ComplianceIssue> = {}): ComplianceIssue => ({
  id,
  date: "2026-11-07",
  kind: "PLANNING",
  severity: "warning",
  rule: "PLANNING_7_DAYS",
  title: "6 Diensttage in Folge",
  description: "Originale Erklärung " + id,
  relatedShiftIds: entries.map((shift) => shift.id),
  facts: { rule: "PLANNING_7_DAYS", count: 6 },
  ...patch,
});
const work = issue("work");
const night = issue("night", {
  rule: "PLANNING_NIGHT_SERIES",
  title: "4 Nächte in Folge",
  relatedShiftIds: [...nightIds, following.id],
  facts: { rule: "PLANNING_NIGHT_SERIES", count: 4, nightSequence: sequence },
});
const recovery = issue("recovery", {
  rule: "PLANNING_NIGHT_RECOVERY",
  title: "25 Stunden frei nach 4 Nächten",
  relatedShiftIds: [...nightIds, following.id],
  facts: { rule: "PLANNING_NIGHT_RECOVERY", count: 4, nightSequence: sequence },
});
const members = (groups: ReturnType<typeof groupCheckDisplayIssues>) =>
  groups.flatMap((group) => [group.primary, ...group.relatedIssues]);

const tariffDuties = [8, 15, 22].map((day) => duty(`2026-11-${String(day).padStart(2, "0")}`));
const tariffObservation = (id: string, later = false): ComplianceIssue => ({
  ...issue(id),
  kind: "LEGAL",
  severity: "info",
  date: later ? "2026-11-22" : "2026-11-15",
  rule: "TARIFF_FREE_SUNDAY",
  title: "Beide Sonntage mit Diensten",
  facts: undefined,
  relatedShiftIds: tariffDuties.slice(later ? 1 : 0, later ? 3 : 2).map((item) => item.id),
  tariff: {
    tariffLabel: "TVöD · BT-K",
    ruleId: "TARIFF_FREE_SUNDAY",
    status: "REVIEW",
    period: {
      from: later ? "2026-11-09" : "2026-11-02",
      until: later ? "2026-11-22" : "2026-11-15",
    },
    source: TARIFF_TIME_POLICIES.TVOED_K.freeSource!,
    ruleText: TARIFF_TIME_POLICIES.TVOED_K.freeRuleText,
    requirements: ["Der tarifliche Bezug ist nicht abschließend bestimmbar."],
    count: 2,
    recordedDates: tariffDuties.slice(later ? 1 : 0, later ? 3 : 2).map((item) => item.date),
  },
});

describe("conservative tariff observation groups", () => {
  it("keeps a seven-day span outside a calendar week separate", () => {
    const days = [3, 4, 5, 6, 7, 8, 9].map((day) =>
      duty(`2026-11-${String(day).padStart(2, "0")}`),
    );
    const first = tariffObservation("non-calendar");
    const item: ComplianceIssue = {
      ...first,
      date: "2026-11-09",
      rule: "TARIFF_WEEK_DAYS",
      relatedShiftIds: days.map((day) => day.id),
      tariff: {
        ...first.tariff!,
        ruleId: "TARIFF_WEEK_DAYS",
        source: TARIFF_TIME_POLICIES.TVOED_K.source,
        period: { from: "2026-11-03", until: "2026-11-09" },
        count: 7,
        limit: 6,
        recordedDates: days.map((day) => day.date),
      },
    };
    expect(
      groupCheckDisplayIssues([item, { ...item, id: "same-non-calendar" }], days, "Europe/Berlin"),
    ).toHaveLength(2);
  });
  it("does not hide a critical result that shares an unavailable observation ID", () => {
    const first = tariffObservation("shared"),
      unavailable = { ...first, tariff: { ...first.tariff!, status: "UNAVAILABLE" as const } };
    const critical = {
      ...first,
      severity: "critical" as const,
      tariff: undefined,
      rule: "UNKNOWN_CRITICAL",
    };
    const original = [unavailable, critical];
    const display = checkDisplayProjection({
      month: "2026-11",
      issues: original,
      criticalCount: 1,
      warningCount: 0,
      infoCount: 1,
      affectedDates: [first.date],
    });
    expect(display.issues).toEqual(original);
    expect(display.prerequisites).toEqual([]);
  });
  it("does not hide an unfamiliar prerequisite that shares a pending observation ID", () => {
    const first = tariffObservation("shared"),
      pending = { ...first, tariff: { ...first.tariff!, status: "PENDING" as const } };
    const unfamiliar = { ...first, tariff: undefined, rule: "UNKNOWN_PREREQUISITE" };
    const original = [pending, unfamiliar];
    const display = checkDisplayProjection({
      month: "2026-11",
      issues: [],
      prerequisites: original,
      prerequisiteCount: 2,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      affectedDates: [],
    });
    expect(display.issues).toEqual([]);
    expect(display.prerequisites).toEqual(original);
  });
  it("places a known unavailable tariff foundation in scope without changing the raw result", () => {
    const first = tariffObservation("unavailable");
    const unavailable = { ...first, tariff: { ...first.tariff!, status: "UNAVAILABLE" as const } };
    const result = {
      month: "2026-11",
      issues: [unavailable],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 1,
      affectedDates: [unavailable.date],
    };
    const before = JSON.stringify(result),
      display = checkDisplayProjection(result);
    expect(display.issues).toEqual([]);
    expect(display.prerequisites).toEqual([unavailable]);
    expect(display.unavailable).toBe(true);
    expect(JSON.stringify(result)).toBe(before);
  });
  it("keeps a known pending observation out of missing-input placement", () => {
    const first = tariffObservation("pending"),
      pending = { ...first, tariff: { ...first.tariff!, status: "PENDING" as const } };
    const result = {
      month: "2026-11",
      issues: [],
      prerequisites: [pending],
      prerequisiteCount: 1,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      affectedDates: [],
    };
    const before = JSON.stringify(result),
      display = checkDisplayProjection(result);
    expect(display.issues).toEqual([pending]);
    expect(display.prerequisites).toEqual([]);
    expect(display.unavailable).toBe(false);
    expect(JSON.stringify(result)).toBe(before);
  });
  it("does not reclassify critical or unfamiliar evidence into scope", () => {
    const first = tariffObservation("critical");
    const critical = {
      ...first,
      severity: "critical" as const,
      tariff: { ...first.tariff!, status: "UNAVAILABLE" as const },
    };
    const unknown = {
      ...first,
      id: "unknown",
      tariff: {
        ...first.tariff!,
        status: "UNAVAILABLE" as const,
        source: { ...first.tariff!.source, url: "https://example.invalid/unknown" },
      },
    };
    const unknownRule = {
      ...first,
      id: "unknown-rule",
      rule: "FUTURE_RULE",
      tariff: { ...first.tariff!, ruleId: "FUTURE_RULE", status: "UNAVAILABLE" as const },
    };
    const display = checkDisplayProjection({
      month: "2026-11",
      issues: [critical, unknown, unknownRule],
      criticalCount: 1,
      warningCount: 0,
      infoCount: 2,
      affectedDates: [first.date],
    });
    expect(display.issues).toEqual([critical, unknown, unknownRule]);
    expect(display.prerequisites).toEqual([]);
  });
  it("groups equal overlapping observations without changing original data or anchors", () => {
    const observations = [tariffObservation("first"), tariffObservation("second", true)];
    const before = JSON.stringify(observations);
    const groups = groupCheckDisplayIssues(observations, tariffDuties, "Europe/Berlin");
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-11-22");
    expect(new Set(members(groups))).toEqual(new Set(observations));
    expect(members(groups)).toHaveLength(2);
    expect(JSON.stringify(observations)).toBe(before);
  });
  it.each<Partial<TariffComplianceEvidence>>([
    { status: "PENDING" },
    { status: "UNAVAILABLE" },
    { count: 3 },
    { requirements: ["Andere Voraussetzung"] },
    { tariffLabel: "Anderer Tarif" },
    { source: TARIFF_TIME_POLICIES.TVL_KR.freeSource! },
    {
      source: {
        ...TARIFF_TIME_POLICIES.TVOED_K.freeSource!,
        url: "https://example.invalid/unknown",
      },
    },
  ])("retains incompatible metadata as separate observations (%j)", (patch) => {
    const first = tariffObservation("first"),
      second = tariffObservation("second", true);
    const changed = { ...second, tariff: { ...second.tariff!, ...patch } };
    expect(groupCheckDisplayIssues([first, changed], tariffDuties, "Europe/Berlin")).toHaveLength(
      2,
    );
  });
  it.each<ComplianceIssue["severity"]>(["critical", "warning"])(
    "never coalesces %s observations",
    (severity) => {
      const observations = [tariffObservation("first"), tariffObservation("second", true)].map(
        (item) => ({ ...item, severity }),
      );
      expect(groupCheckDisplayIssues(observations, tariffDuties, "Europe/Berlin")).toHaveLength(2);
    },
  );
  it("keeps missing, ambiguous and unrelated duty evidence separate", () => {
    const observations = [tariffObservation("first"), tariffObservation("second", true)];
    expect(
      groupCheckDisplayIssues(observations, tariffDuties.slice(1), "Europe/Berlin"),
    ).toHaveLength(2);
    expect(
      groupCheckDisplayIssues(observations, [...tariffDuties, tariffDuties[1]], "Europe/Berlin"),
    ).toHaveLength(2);
    const disjoint = { ...observations[1], relatedShiftIds: [tariffDuties[2].id] };
    expect(
      groupCheckDisplayIssues([observations[0], disjoint], tariffDuties, "Europe/Berlin"),
    ).toHaveLength(2);
  });
  it("does not merge when duty dates contradict the evidence or lie outside the claimed periods", () => {
    const observations = [tariffObservation("first"), tariffObservation("second", true)];
    const outside = tariffDuties.map((item) => ({
      ...item,
      date: item.date.replace("2026-11", "2026-10"),
    }));
    expect(groupCheckDisplayIssues(observations, outside, "Europe/Berlin")).toHaveLength(2);
    const inconsistent = tariffDuties.map((item, index) =>
      index === 1 ? { ...item, date: "2026-11-16" } : item,
    );
    expect(groupCheckDisplayIssues(observations, inconsistent, "Europe/Berlin")).toHaveLength(2);
  });
  it("does not assume a timezone when proving a tariff observation", () => {
    const observations = [tariffObservation("first"), tariffObservation("second", true)];
    expect(groupCheckDisplayIssues(observations, tariffDuties)).toHaveLength(2);
    expect(groupCheckDisplayIssues(observations, tariffDuties, "Invalid/Zone")).toHaveLength(2);
  });
  it("uses actual night overlap across midnight and the clock change", () => {
    const nights = ["2026-10-24", "2026-10-31", "2026-11-07"].map((date) => duty(date, true));
    const first = tariffObservation("dst-first"),
      second = tariffObservation("dst-second", true);
    const original: ComplianceIssue[] = [
      {
        ...first,
        date: "2026-11-01",
        relatedShiftIds: nights.slice(0, 2).map((item) => item.id),
        tariff: {
          ...first.tariff!,
          period: { from: "2026-10-19", until: "2026-11-01" },
          recordedDates: ["2026-10-25", "2026-11-01"],
        },
      },
      {
        ...second,
        date: "2026-11-08",
        relatedShiftIds: nights.slice(1).map((item) => item.id),
        tariff: {
          ...second.tariff!,
          period: { from: "2026-10-26", until: "2026-11-08" },
          recordedDates: ["2026-11-01", "2026-11-08"],
        },
      },
    ];
    expect(groupCheckDisplayIssues(original, nights, "Europe/Berlin")).toHaveLength(1);
  });
});

describe("lossless check display groups", () => {
  it("combines a general work series and its night series without counting the following duty as a night", () => {
    const groups = groupCheckDisplayIssues([night, work], allEntries);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(work);
    expect(groups[0].relatedIssues).toEqual([night]);
    expect(groups[0].relatedIssues[0]).toBe(night);
    expect(members(groups)).toHaveLength(2);
  });

  it("keeps all three original observations and selects the general series as primary", () => {
    const groups = groupCheckDisplayIssues([recovery, night, work], allEntries);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(work);
    expect(new Set(members(groups))).toEqual(new Set([work, night, recovery]));
    expect(members(groups)).toHaveLength(3);
  });

  it("combines a night series and recovery only for the same complete validated sequence", () => {
    const groups = groupCheckDisplayIssues([recovery, night], allEntries);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(night);
    expect(groups[0].relatedIssues).toEqual([recovery]);
  });

  it("uses the latest observation date while preserving both original anchors", () => {
    const extra = duty("2026-11-08");
    const extendedWork = issue("extended-work", {
      date: "2026-11-08",
      relatedShiftIds: [...work.relatedShiftIds, extra.id],
      facts: { rule: "PLANNING_7_DAYS", count: 7 },
    });
    const nextNight = {
      ...night,
      relatedShiftIds: [...nightIds, extra.id],
      facts: {
        rule: "PLANNING_NIGHT_SERIES" as const,
        count: 4,
        nightSequence: {
          ...sequence,
          nextShiftId: extra.id,
          recoveryStatus: "under24" as const,
          restMinutes: 60,
        },
      },
    };
    const groups = groupCheckDisplayIssues([nextNight, extendedWork], [...entries, extra]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-11-08");
    expect(nextNight.date).toBe("2026-11-07");
    expect(extendedWork.date).toBe("2026-11-08");
  });

  it.each(["LEGAL", "TARIFF", "PLANNING_WEEKENDS", "PLANNING_LATE_EARLY", "UNKNOWN"])(
    "does not bundle %s merely because its date or services match",
    (kind) => {
      const separate = issue(
        kind,
        kind === "LEGAL" || kind === "TARIFF"
          ? { kind: "LEGAL", rule: kind === "TARIFF" ? "TARIFF_WEEK_DAYS" : "ARBZG_4_BREAK" }
          : { rule: kind },
      );
      const groups = groupCheckDisplayIssues([work, separate], allEntries);
      expect(groups).toHaveLength(2);
      expect(new Set(members(groups))).toEqual(new Set([work, separate]));
    },
  );

  it("does not merge separate night sequences with coincident observation dates", () => {
    const different = {
      ...recovery,
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY" as const,
        count: 4,
        nightSequence: { ...sequence, firstNight: "2026-11-03", lastNight: "2026-11-06" },
      },
    };
    expect(groupCheckDisplayIssues([night, different], allEntries)).toHaveLength(2);
  });

  it("does not indirectly combine incompatible overlapping sequences through a work block", () => {
    const shifted = {
      ...recovery,
      id: "shifted",
      date: "2026-11-06",
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY" as const,
        count: 4,
        nightSequence: { ...sequence, firstNight: "2026-11-03", lastNight: "2026-11-06" },
      },
    };
    const observations = [work, night, shifted];
    const grouped = groupCheckDisplayIssues(observations, allEntries);
    expect(grouped).toHaveLength(3);
    expect(new Set(members(grouped))).toEqual(new Set(observations));
    expect(groupCheckDisplayIssues([...observations].reverse(), allEntries)).toEqual(grouped);
  });

  it("keeps even a matching night/recovery pair separate when overlapping evidence conflicts", () => {
    const shifted = {
      ...recovery,
      id: "shifted",
      date: "2026-11-06",
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY" as const,
        count: 4,
        nightSequence: { ...sequence, firstNight: "2026-11-03", lastNight: "2026-11-06" },
      },
    };
    const observations = [work, night, recovery, shifted];
    const grouped = groupCheckDisplayIssues(observations, allEntries);
    expect(grouped).toHaveLength(4);
    expect(new Set(members(grouped))).toEqual(new Set(observations));
  });

  it("can still bundle distinct non-overlapping night blocks within one complete work series", () => {
    const longEntries = Array.from({ length: 10 }, (_, index) =>
      duty(`2026-11-${String(index + 2).padStart(2, "0")}`, index < 4 || index >= 6),
    );
    const after = duty("2026-11-13");
    const longWork = issue("long-work", {
      date: "2026-11-11",
      relatedShiftIds: longEntries.map((shift) => shift.id),
      facts: { rule: "PLANNING_7_DAYS", count: 10 },
    });
    const firstNight = issue("first-night", {
      date: "2026-11-05",
      rule: "PLANNING_NIGHT_SERIES",
      relatedShiftIds: longEntries.slice(0, 5).map((shift) => shift.id),
      facts: {
        rule: "PLANNING_NIGHT_SERIES",
        count: 4,
        nightSequence: {
          ...sequence,
          firstNight: "2026-11-02",
          lastNight: "2026-11-05",
          lastShiftId: longEntries[3].id,
          nextShiftId: longEntries[4].id,
          recoveryStatus: "under24",
          restMinutes: 60,
        },
      },
    });
    const secondNight = issue("second-night", {
      date: "2026-11-11",
      rule: "PLANNING_NIGHT_SERIES",
      relatedShiftIds: [...longEntries.slice(6).map((shift) => shift.id), after.id],
      facts: {
        rule: "PLANNING_NIGHT_SERIES",
        count: 4,
        nightSequence: {
          ...sequence,
          firstNight: "2026-11-08",
          lastNight: "2026-11-11",
          lastShiftId: longEntries[9].id,
          nextShiftId: after.id,
        },
      },
    });
    const grouped = groupCheckDisplayIssues(
      [longWork, firstNight, secondNight],
      [...longEntries, after],
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].primary).toBe(longWork);
    expect(new Set(members(grouped))).toEqual(new Set([longWork, firstNight, secondNight]));
  });

  it("does not combine conflicting recovery evidence even for the same night dates", () => {
    const different = {
      ...recovery,
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY" as const,
        count: 4,
        nightSequence: { ...sequence, restMinutes: 1_600 },
      },
    };
    expect(groupCheckDisplayIssues([night, different], allEntries)).toHaveLength(2);
  });

  it("matches validated sequence values independently of object property order", () => {
    const reordered = {
      ...recovery,
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY" as const,
        count: 4,
        nightSequence: {
          nextShiftId: sequence.nextShiftId,
          lastShiftId: sequence.lastShiftId,
          restMinutes: sequence.restMinutes,
          recoveryStatus: sequence.recoveryStatus,
          countIsMinimum: sequence.countIsMinimum,
          lastNight: sequence.lastNight,
          firstNight: sequence.firstNight,
          policyVersion: sequence.policyVersion,
        },
      },
    };
    expect(groupCheckDisplayIssues([night, reordered], allEntries)).toHaveLength(1);
  });

  it.each([
    { name: "missing night", shifts: allEntries.filter((shift) => shift.id !== nightIds[0]) },
    { name: "missing following duty", shifts: entries },
    { name: "duplicate duty id", shifts: [...allEntries, { ...entries[0] }] },
    {
      name: "deleted work duty",
      shifts: allEntries.map((shift, index) =>
        index === 0 ? { ...shift, deletedAt: "2026-11-09" } : shift,
      ),
    },
  ])("leaves uncertain $name ungrouped", ({ shifts }) => {
    expect(groupCheckDisplayIssues([work, night], shifts)).toHaveLength(2);
  });

  it("requires the declared following duty in the original related ids and the duty lookup", () => {
    const partial = { ...night, relatedShiftIds: nightIds };
    for (const shifts of [entries, allEntries])
      expect(groupCheckDisplayIssues([work, partial], shifts)).toHaveLength(2);
  });

  it("leaves an ambiguous pair of general series and the night observation separate", () => {
    const otherWork = { ...work, id: "other-work" };
    expect(groupCheckDisplayIssues([work, night, otherWork], allEntries)).toHaveLength(3);
  });

  it("requires a continuous and correctly counted general service block", () => {
    const discontinuous = allEntries.map((shift, index) =>
      index === 0 ? { ...shift, date: "2026-11-01" } : shift,
    );
    expect(groupCheckDisplayIssues([work, night], discontinuous)).toHaveLength(2);
    const incorrectCount = { ...work, facts: { rule: "PLANNING_7_DAYS" as const, count: 7 } };
    expect(groupCheckDisplayIssues([incorrectCount, night], allEntries)).toHaveLength(2);
  });

  it("does not bundle malformed night facts or absent legacy facts", () => {
    const malformed = {
      ...night,
      facts: {
        rule: "PLANNING_NIGHT_SERIES" as const,
        count: 4,
        nightSequence: { ...sequence, restMinutes: 10_000 },
      },
    };
    const { facts: _facts, ...legacyWithoutFacts } = night;
    expect(groupCheckDisplayIssues([work, malformed], allEntries)).toHaveLength(2);
    expect(groupCheckDisplayIssues([work, legacyWithoutFacts], allEntries)).toHaveLength(2);
  });

  it("can associate complete legacy counted night evidence with one proved service block", () => {
    const legacy = {
      ...night,
      relatedShiftIds: nightIds,
      facts: { rule: "PLANNING_NIGHT_SERIES" as const, count: 4 },
    };
    expect(groupCheckDisplayIssues([work, legacy], entries)).toHaveLength(1);
  });

  it("never groups the following duty as though it belonged to an unrelated night series", () => {
    const laterEntries = Array.from({ length: 6 }, (_, index) => duty(`2026-11-${index + 20}`));
    const laterWork = issue("later-work", {
      date: "2026-11-25",
      relatedShiftIds: laterEntries.map((shift) => shift.id),
    });
    const laterNight = {
      ...night,
      relatedShiftIds: [...nightIds, laterEntries[0].id],
      facts: {
        rule: "PLANNING_NIGHT_SERIES" as const,
        count: 4,
        nightSequence: { ...sequence, nextShiftId: laterEntries[0].id },
      },
    };
    expect(
      groupCheckDisplayIssues([laterWork, laterNight], [...entries, ...laterEntries]),
    ).toHaveLength(2);
  });

  it("keeps unknown critical planning observations separate", () => {
    expect(
      groupCheckDisplayIssues([work, { ...night, severity: "critical" }], allEntries),
    ).toHaveLength(2);
  });

  it("does not collapse two ambiguous copies of one kind of night observation", () => {
    expect(
      groupCheckDisplayIssues([work, night, { ...night, id: "second-night" }], allEntries),
    ).toHaveLength(3);
  });

  it("does not move raw observations across their reporting month", () => {
    expect(
      groupCheckDisplayIssues([work, { ...night, date: "2026-10-31" }], allEntries),
    ).toHaveLength(2);
  });

  it("does not bundle an observation with an anchor inconsistent with its proved block", () => {
    expect(
      groupCheckDisplayIssues([{ ...work, date: "2026-11-03" }, night], allEntries),
    ).toHaveLength(2);
    expect(
      groupCheckDisplayIssues([work, { ...night, date: "2026-11-08" }], allEntries),
    ).toHaveLength(2);
  });

  it("retains duplicate observation IDs separately with stable display keys", () => {
    const changed = {
      ...work,
      title: "Anderer Originalbefund",
      description: "Andere Originalaussage",
    };
    const first = groupCheckDisplayIssues([work, changed], allEntries);
    const second = groupCheckDisplayIssues([changed, work], allEntries);
    expect(first).toHaveLength(2);
    expect(new Set(first.map((group) => group.id)).size).toBe(2);
    expect(first).toEqual(second);
    expect(new Set(members(first))).toEqual(new Set([work, changed]));
  });

  it("returns deterministic groups without mutating inputs or replacing original observations", () => {
    const input = [night, work, recovery];
    const jsonBefore = JSON.stringify({ input, allEntries });
    const first = groupCheckDisplayIssues(input, allEntries);
    const second = groupCheckDisplayIssues([...input].reverse(), [...allEntries].reverse());
    expect(first).toEqual(second);
    expect(JSON.stringify({ input, allEntries })).toBe(jsonBefore);
    for (const original of input)
      expect(members(first).filter((item) => item === original)).toHaveLength(1);
  });
});
