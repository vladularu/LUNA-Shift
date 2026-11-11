import { afterEach, describe, expect, it } from "vitest";
import { appResumeHref } from "@/navigation/app-resume-state";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import {
  createCheckIssueSession,
  currentCheckIssueSession,
  invalidateCheckIssueSession,
  isCheckIssueSessionInvalidated,
  readCheckIssueSession,
  releaseCheckIssueSession,
  subscribeCheckIssueSession,
} from "./check-issue-session";

const issue: ComplianceIssue = {
  id: "private-finding",
  kind: "PLANNING",
  severity: "info",
  rule: "PLANNING_7_DAYS",
  date: "2026-11-29",
  title: "Dienstfolge",
  description: "Prüfhinweis",
  relatedShiftIds: [],
};
afterEach(() => {
  const current = currentCheckIssueSession();
  if (current) releaseCheckIssueSession(current.id);
});
describe("local native check-detail handoff", () => {
  it("binds the selected finding to an opaque token and never resumes its private payload", () => {
    const original: ShiftEntry[] = [];
    const request = createCheckIssueSession({
      issue,
      shifts: original,
      timeZone: "Europe/Berlin",
    })!;
    expect(readCheckIssueSession(request.id)?.issue).toBe(issue);
    expect(request.id).not.toContain(issue.id);
    expect(request.shifts).not.toBe(original);
    expect(readCheckIssueSession("other-token")).toBeNull();
    expect(appResumeHref("/check-issue", { session: request.id })).toBeNull();
  });
  it("prevents duplicate presentations and ignores stale dismissals", () => {
    const first = createCheckIssueSession({ issue, shifts: [], timeZone: "Europe/Berlin" })!;
    expect(
      createCheckIssueSession({ issue: { ...issue, id: "other" }, shifts: [], timeZone: "UTC" }),
    ).toBeNull();
    releaseCheckIssueSession("stale-token");
    expect(currentCheckIssueSession()).toBe(first);
    releaseCheckIssueSession(first.id);
    expect(currentCheckIssueSession()).toBeNull();
    const second = createCheckIssueSession({ issue, shifts: [], timeZone: "UTC" })!;
    expect(second.id).not.toBe(first.id);
    releaseCheckIssueSession(first.id);
    expect(currentCheckIssueSession()).toBe(second);
  });
  it("notifies the route on opening and cleanup and allows unsubscribe", () => {
    let changes = 0;
    const stop = subscribeCheckIssueSession(() => changes++);
    const request = createCheckIssueSession({ issue, shifts: [], timeZone: "UTC" })!;
    releaseCheckIssueSession(request.id);
    expect(changes).toBe(2);
    stop();
    createCheckIssueSession({ issue, shifts: [], timeZone: "UTC" });
    expect(changes).toBe(2);
  });
  it("hides a removed finding but keeps its presentation locked until native dismissal", () => {
    const input = { issue, shifts: [], timeZone: "UTC" };
    const first = createCheckIssueSession(input)!;
    invalidateCheckIssueSession("stale-token");
    expect(readCheckIssueSession(first.id)).toBe(first);
    invalidateCheckIssueSession(first.id);
    expect(readCheckIssueSession(first.id)).toBeNull();
    expect(isCheckIssueSessionInvalidated(first.id)).toBe(true);
    expect(createCheckIssueSession(input)).toBeNull();
    releaseCheckIssueSession(first.id);
    const second = createCheckIssueSession(input)!;
    invalidateCheckIssueSession(first.id);
    expect(readCheckIssueSession(second.id)).toBe(second);
    expect(isCheckIssueSessionInvalidated(second.id)).toBe(false);
  });
});
