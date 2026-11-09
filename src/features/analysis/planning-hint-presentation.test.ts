import { describe, expect, it } from "vitest";
import type { ComplianceIssue } from "@/domain/types";
import type { PlanningNightSequence } from "@/domain/planning-night-policy";
import { planningHintPresentation } from "./planning-hint-presentation";
import { Temporal } from "@js-temporal/polyfill";
import {
  PLANNING_WEEKEND_POLICY,
  planningWeekendWindowEnds,
  type PlanningWeekend,
  type PlanningWeekendAssessment,
} from "@/domain/planning-weekend-policy";

function weekends(
  free = 1,
  unknown = false,
  occupiedFrom = free === 0 ? "2026-11-08" : "2026-11-15",
  freeAgainFrom = "9999-12-31",
): PlanningWeekendAssessment {
  const weekend = (sunday: string): PlanningWeekend => {
    const status =
      unknown && sunday === "2026-11-29"
        ? "UNKNOWN"
        : sunday >= occupiedFrom && sunday < freeAgainFrom
          ? "OCCUPIED"
          : "FREE";
    return {
      saturday: Temporal.PlainDate.from(sunday).subtract({ days: 1 }).toString(),
      sunday,
      status,
      relatedShiftIds: status === "OCCUPIED" ? [sunday] : [],
      reasons:
        status === "OCCUPIED"
          ? ["WORK_RECORDED"]
          : status === "UNKNOWN"
            ? ["OUTSIDE_COVERAGE"]
            : [],
    };
  };
  const counts = (items: readonly PlanningWeekend[]) => ({
    freeCount: items.filter((item) => item.status === "FREE").length,
    occupiedCount: items.filter((item) => item.status === "OCCUPIED").length,
    unknownCount: items.filter((item) => item.status === "UNKNOWN").length,
  });
  const ends = planningWeekendWindowEnds("2026-11"),
    items = ends.map(weekend);
  return {
    policyVersion: PLANNING_WEEKEND_POLICY.version,
    month: "2026-11",
    totalCount: items.length,
    weekends: items,
    ...counts(items),
    windows: ends.map((until) => {
      const day = Temporal.PlainDate.from(until),
        members = [3, 2, 1, 0].map((weeks) => weekend(day.subtract({ weeks }).toString()));
      return {
        from: day.subtract({ days: 27 }).toString(),
        until,
        weekends: members,
        assessmentComplete: members.every((item) => item.status !== "UNKNOWN"),
        ...counts(members),
      };
    }),
  };
}

function night(
  count = 4,
  status: PlanningNightSequence["recoveryStatus"] = "atLeast48",
  minutes: number | null = 2910,
): ComplianceIssue {
  const rule = count >= 4 ? "PLANNING_NIGHT_SERIES" : "PLANNING_NIGHT_RECOVERY";
  return {
    id: "night",
    date: "2026-08-07",
    title: "Alter Titel",
    description: "Unveränderter Originaltext",
    kind: "PLANNING",
    severity: "warning",
    relatedShiftIds: [],
    facts: {
      rule,
      count,
      nightSequence: {
        policyVersion: "2026-11-07",
        firstNight: Temporal.PlainDate.from("2026-08-07")
          .subtract({ days: count - 1 })
          .toString(),
        lastNight: "2026-08-07",
        countIsMinimum: false,
        recoveryStatus: status,
        restMinutes: minutes,
        lastShiftId: "last",
        nextShiftId: minutes === null ? null : "next",
      },
    },
    rule,
  };
}

describe("plain planning hint presentation", () => {
  it("keeps known planning explanations and recommendations within two short sentences", () => {
    const issues: ComplianceIssue[] = [
      night(6, "under48", 1788),
      night(3, "under24", 0),
      { ...night(), rule: "PLANNING_7_DAYS", facts: { rule: "PLANNING_7_DAYS", count: 7 } },
      {
        ...night(),
        rule: "PLANNING_WEEKEND_RECOVERY",
        facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: weekends(1) },
      },
    ];
    for (const issue of issues) {
      const hint = planningHintPresentation(issue);
      const direct = [hint.explanation, hint.recommendation]
        .filter(Boolean)
        .join(" ")
        .replace(/\b(?:Std|Min)\./g, "");
      expect(direct.match(/[.!?](?:\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(2);
      expect(direct).not.toMatch(/arbeitswissenschaftlich|Tarif|Prüfkriterium|Kalenderwoche/);
    }
    expect(planningHintPresentation(night(3, "under24", 0)).compactSummary).toBe(
      "Danach 0 Min. frei.",
    );
  });
  it("keeps the August six-night row to the observed count and real time off", () => {
    const hint = planningHintPresentation(night(6, "under48", 1788));
    expect(hint.compactTitle).toBe("6 Nächte in Folge");
    expect(hint.compactSummary).toBe("Danach 29 Std. 48 Min. frei.");
    expect(hint.compactSummary).not.toMatch(/18 Std|12 Min|unter|empfohlen|höchstens/i);
    expect(hint.recommendation).toBe(
      "Empfohlen sind höchstens 3 Nächte in Folge und danach möglichst 48 Stunden frei.",
    );
    expect(hint.recommendation).not.toContain("24");
  });
  it("shows real free time without an additional deficit calculation", () => {
    const hint = planningHintPresentation(night(3, "under48", 2850));
    expect(hint.compactTitle).toBe("Erholung nach 3 Nächten");
    expect(hint.compactSummary).toBe("Danach 47 Std. 30 Min. frei.");
    expect(hint.compactSummary).not.toMatch(/unter|Empfohlen|48/);
    expect(hint.summary.join(" ")).not.toContain("24");
    expect(hint.recommendation).toContain("48");
    expect(hint.explanation).not.toContain("24");
  });
  it("uses only the applicable 24-hour recovery recommendation below 24 hours", () => {
    const hint = planningHintPresentation(night(3, "under24", 1380));
    expect(hint.compactTitle).toBe("Erholung nach 3 Nächten");
    expect(hint.compactSummary).toBe("Danach 23 Std. frei.");
    expect(
      [hint.summary.join(" "), hint.recommendation, hint.explanation, hint.recoveryNote].join(" "),
    ).not.toContain("48");
  });
  it.each([2880, 2910])(
    "keeps the recovery fact without extra recovery advice at %i minutes",
    (minutes) => {
      const hint = planningHintPresentation(night(4, "atLeast48", minutes));
      expect(hint.compactTitle).toBe("4 Nächte in Folge");
      expect(hint.compactSummary).toBe(
        minutes === 2880 ? "Danach 48 Std. frei." : "Danach 48 Std. 30 Min. frei.",
      );
      expect(hint.recommendation).not.toMatch(/24|48/);
    },
  );
  it("selects the latest tightest eligible weekend window without changing facts", () => {
    const data = weekends(0, false, "2026-10-18"),
      before = JSON.stringify(data);
    const hint = planningHintPresentation({
      ...night(),
      rule: "PLANNING_WEEKEND_RECOVERY",
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: data },
    });
    expect(hint.weekendPeriod).toEqual({ from: "2026-11-02", until: "2026-11-29" });
    expect(hint.compactTitle).toBe("Kein freies Wochenende in 4 Wochen");
    expect(hint.compactSummary).toContain("mindestens 2");
    expect(JSON.stringify(data)).toBe(before);
  });
  it("uses the tighter earlier bad window before a newer one with more free weekends", () => {
    const data = weekends(0, false, "2026-10-11", "2026-11-29");
    const hint = planningHintPresentation({
      ...night(),
      rule: "PLANNING_WEEKEND_RECOVERY",
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: data },
    });
    expect(data.windows.at(-1)?.freeCount).toBe(1);
    expect(hint.weekendPeriod).toEqual({ from: "2026-10-26", until: "2026-11-22" });
    expect(hint.compactTitle).toBe("Kein freies Wochenende in 4 Wochen");
  });
  it.each([0, 1])(
    "describes %i free weekends against the source-specific four-week criterion",
    (count) => {
      const hint = planningHintPresentation({
        ...night(),
        rule: "PLANNING_WEEKEND_RECOVERY",
        facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: weekends(count) },
      });
      expect(hint.title).toBe(
        count === 1 ? "1 freies Wochenende in 4 Wochen" : "Kein freies Wochenende in 4 Wochen",
      );
      expect(hint.summary).toEqual(["Empfohlen sind mindestens 2 freie Wochenenden in 4 Wochen."]);
      expect(hint.sources[0]).toEqual(PLANNING_WEEKEND_POLICY.source);
      expect(hint.policyNote).toContain("Samstag und Sonntag");
      expect(hint.policyNote).toContain("keine gesetzliche");
      expect(hint.weekendAssessment).toEqual(weekends(count));
      expect(hint.explanation).not.toMatch(/jedes zweite|drei Wochenenden in Folge/);
    },
  );

  it("makes the night count the only card reason when recovery reaches 48 hours", () => {
    const issue = night();
    const before = JSON.stringify(issue);
    const hint = planningHintPresentation(issue);
    expect(hint.title).toBe("4 Nächte in Folge");
    expect(hint.summary).toEqual(["Danach 48 Std. 30 Min. frei."]);
    expect(hint.sources.map((source) => source.title)).toEqual(
      expect.arrayContaining([expect.stringContaining("BGW"), expect.stringContaining("BAuA")]),
    );
    expect(JSON.stringify(hint.summary)).not.toContain("48:30");
    expect(hint.recoveryNote).toBeNull();
    expect(JSON.stringify(issue)).toBe(before);
  });
  it.each([
    ["under24", 1439, "mindestens 24"],
    ["under48", 1440, "möglichst 48"],
  ] as const)(
    "clearly separates the %s recovery recommendation",
    (status, minutes, recommendation) => {
      const hint = planningHintPresentation(night(2, status, minutes));
      expect(hint.title).toBe("Erholung nach 2 Nächten");
      expect(hint.summary.join(" ")).not.toContain("Empfohlen");
      expect(hint.explanation).toContain("nächsten Dienst");
      expect(hint.recommendation).toContain(recommendation);
      expect(hint.explanation).not.toMatch(/24 Stunden|48 Stunden/);
    },
  );
  it("keeps both actual reasons compact for a combined finding", () => {
    const hint = planningHintPresentation(night(4, "under24", 1439));
    expect(hint.title).toBe("4 Nächte in Folge");
    expect(hint.summary).toEqual(["Danach 23 Std. 59 Min. frei."]);
    expect(hint.recommendation).toContain("mindestens 24");
  });
  it.each(["open", "unknown"] as const)("does not invent free time when it is %s", (status) => {
    const hint = planningHintPresentation(night(4, status, null));
    expect(hint.summary).toHaveLength(1);
    expect(hint.explanation).not.toMatch(/null|\d+:\d+/);
    expect(hint.recoveryNote).toBeNull();
  });
  it("does not relabel a retired three-weekend observation as a new four-week finding", () => {
    const issue = {
      ...night(),
      rule: "PLANNING_WEEKENDS",
      facts: { rule: "PLANNING_WEEKENDS" as const },
    };
    const hint = planningHintPresentation(issue);
    expect(hint.title).toBe("Alter Titel");
    expect(hint.compactTitle).toBeUndefined();
    expect(hint.compactSummary).toBeUndefined();
    expect(hint.summary).toEqual([]);
    expect(hint.sources).toEqual([]);
    expect(hint.scientificNight).toBe(false);
  });
  it("does not turn an open four-week window into a negative zero-free observation", () => {
    const hint = planningHintPresentation({
      ...night(),
      rule: "PLANNING_WEEKEND_RECOVERY",
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment: weekends(1, true) },
    });
    expect(hint.title).toBe("Alter Titel");
    expect(hint.summary).toEqual([]);
  });
  it("requires complete assessment even when all four weekends are safely occupied", () => {
    const data = weekends(0);
    const hint = planningHintPresentation({
      ...night(),
      rule: "PLANNING_WEEKEND_RECOVERY",
      facts: {
        rule: "PLANNING_WEEKEND_RECOVERY",
        assessment: {
          ...data,
          windows: data.windows.map((window) => ({ ...window, assessmentComplete: false })),
        },
      },
    });
    expect(hint.title).toBe("Alter Titel");
    expect(hint.summary).toEqual([]);
  });
  it("ties the work-series recommendation to the selected BAuA source", () => {
    const hint = planningHintPresentation({
      ...night(),
      rule: "PLANNING_7_DAYS",
      facts: { rule: "PLANNING_7_DAYS", count: 7 },
    });
    expect(hint.title).toBe("7 Diensttage in Folge");
    expect(hint.summary).toEqual(["Empfohlen sind höchstens 5 Diensttage in Folge."]);
    expect(hint.explanation).toBe("Du hast 7 Diensttage in Folge eingetragen.");
    expect(hint.explanation).not.toMatch(/Tarif|Kalenderwoche|arbeitswissenschaftlich/);
    expect(hint.sources[0].url).toContain("Handbuch-Gefaehrdungsbeurteilung");
  });
});
