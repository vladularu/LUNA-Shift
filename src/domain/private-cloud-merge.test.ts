import { describe, expect, it } from "vitest";
import type { CloudJson, PrivateCloudDocument } from "./private-cloud";
import { mergePrivateCloudDocuments } from "./private-cloud-merge";

const document = (
  shifts: readonly CloudJson[],
  profile: CloudJson = null,
): PrivateCloudDocument => ({
  format: "lunashift-private-cloud",
  version: 1,
  backupVersion: 20,
  databaseSchemaVersion: 100,
  data: { shifts, profile },
  presentation: { calendarImage: null, calendarImageStrength: "medium" },
});
const shift = (id: string, title: string, note = "") => ({ id, title, note, revision: 1 });

describe("private cloud three-way merge", () => {
  it("combines independent offline additions from two devices", () => {
    const result = mergePrivateCloudDocuments(
      document([]),
      document([shift("a", "Früh")]),
      document([shift("b", "Nacht")]),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.document.data.shifts).toEqual([shift("a", "Früh"), shift("b", "Nacht")]);
  });
  it("combines different edited fields on the same record", () => {
    const result = mergePrivateCloudDocuments(
      document([shift("a", "Früh")]),
      document([shift("a", "Nacht")]),
      document([shift("a", "Früh", "Privat")]),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.document.data.shifts).toEqual([shift("a", "Nacht", "Privat")]);
  });
  it("does not let a later device clock win a conflicting edit", () => {
    const result = mergePrivateCloudDocuments(
      document([shift("a", "Früh")]),
      document([{ ...shift("a", "Nacht"), updated_at: "2027-01-01" }]),
      document([{ ...shift("a", "Spät"), updated_at: "2028-01-01" }]),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.document.data.shifts).toEqual([
      { ...shift("a", "Nacht"), updated_at: "2028-01-01" },
    ]);
  });
  it("propagates deletion when the other device did not change that record", () => {
    const before = document([shift("a", "Früh")]);
    expect(mergePrivateCloudDocuments(before, document([]), before)).toEqual({
      document: document([]),
      conflicts: [],
    });
  });
  it("requires a choice for a deletion concurrent with an edit", () => {
    const result = mergePrivateCloudDocuments(
      document([shift("a", "Früh")]),
      document([]),
      document([shift("a", "Nacht")]),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.document.data.shifts).toEqual([]);
  });
  it("also treats a retained tombstone concurrent with an edit as a conflict", () => {
    const original = { ...shift("a", "Früh"), deleted_at: null };
    const result = mergePrivateCloudDocuments(
      document([original]),
      document([{ ...original, deleted_at: "2026-10-17" }]),
      document([{ ...original, title: "Nacht" }]),
    );
    expect(result.conflicts).toHaveLength(1);
  });
  it("merges singleton work profile fields without exposing other collections", () => {
    const result = mergePrivateCloudDocuments(
      document([], { id: "singleton", federal_state: "HE", weekly_minutes: 2400 }),
      document([], { id: "singleton", federal_state: "BW", weekly_minutes: 2400 }),
      document([], { id: "singleton", federal_state: "HE", weekly_minutes: 2300 }),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.document.data.profile).toEqual({
      id: "singleton",
      federal_state: "BW",
      weekly_minutes: 2300,
    });
  });
  it("merges preferences by key and records competing photos as conflicts", () => {
    const before = document([]);
    const left = { ...before, presentation: { ...before.presentation, calendarImage: "photo-a" } };
    const right = { ...before, presentation: { ...before.presentation, calendarImage: "photo-b" } };
    expect(mergePrivateCloudDocuments(before, left, right).conflicts).toEqual([
      "presentation.calendarImage",
    ]);
  });
});
