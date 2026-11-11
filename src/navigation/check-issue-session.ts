import type { ComplianceIssue, ShiftEntry } from "@/domain/types";

export interface CheckIssueInput {
  readonly issue: ComplianceIssue;
  readonly relatedIssues?: readonly ComplianceIssue[];
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
}
export interface CheckIssueSession extends CheckIssueInput {
  readonly id: string;
}

let current: CheckIssueSession | null = null;
let invalidatedId: string | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** One in-memory handoff; finding data never becomes URL or persisted route data. */
export function createCheckIssueSession(input: CheckIssueInput): CheckIssueSession | null {
  if (current) return null;
  current = Object.freeze({
    ...input,
    id: `check-${Date.now().toString(36)}-${++sequence}`,
    relatedIssues: Object.freeze([...(input.relatedIssues ?? [])]),
    shifts: Object.freeze([...input.shifts]),
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
