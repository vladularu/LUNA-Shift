import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import type { PlanningWeekendWindow } from "@/domain/planning-weekend-policy";

export interface CheckIssueInput {
  readonly issue: ComplianceIssue;
  readonly relatedIssues?: readonly ComplianceIssue[];
  readonly weekend?: PlanningWeekendWindow;
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
}
export interface WorkplaceIssueInput {
  readonly workplace: { readonly period: string; readonly key: string };
  readonly issue?: never;
}
export type CheckDetailInput = CheckIssueInput | WorkplaceIssueInput;
export type CheckIssueSession = CheckDetailInput & { readonly id: string };

let current: CheckIssueSession | null = null;
let invalidatedId: string | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** One in-memory handoff; finding data never becomes URL or persisted route data. */
export function createCheckIssueSession(
  input: CheckIssueInput,
): (CheckIssueInput & { readonly id: string }) | null;
export function createCheckIssueSession(input: CheckDetailInput): CheckIssueSession | null;
export function createCheckIssueSession(input: CheckDetailInput): CheckIssueSession | null {
  if (current) return null;
  current = Object.freeze({
    ...input,
    id: `check-${Date.now().toString(36)}-${++sequence}`,
    ...("workplace" in input
      ? { workplace: Object.freeze({ ...input.workplace }) }
      : {
          relatedIssues: Object.freeze([...(input.relatedIssues ?? [])]),
          shifts: Object.freeze([...input.shifts]),
        }),
  });
  notify();
  return current;
}

export const currentCheckIssueSession = () => current;
export function readCheckIssueSession(id: string | null): CheckIssueSession | null {
  return id && current?.id === id && invalidatedId !== id ? current : null;
}
export const isCheckIssueSessionInvalidated = (id: string | null) =>
  id !== null && current?.id === id && invalidatedId === id;
export function invalidateCheckIssueSession(id: string) {
  if (current?.id !== id || invalidatedId === id) return;
  invalidatedId = id;
  notify();
}
export function releaseCheckIssueSession(id: string) {
  if (current?.id !== id) return;
  current = null;
  invalidatedId = null;
  notify();
}
export function subscribeCheckIssueSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
