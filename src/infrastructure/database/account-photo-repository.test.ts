import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TariffAnnualTestDatabase } from "./tariff-annual-test-database";
import { createPrivateCloudLocal, migratePrivateCloud } from "./private-cloud-repository";
import { loadAccountPhoto, saveAccountPhoto, writeAccountPhoto } from "./account-photo-repository";
import {
  readCloudPresentation,
  prepareCloudPresentation,
} from "@/features/private-cloud/cloud-media";
import { validatePrivateCloudDocument } from "@/infrastructure/private-cloud/cloud-document";
import { LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import { mergePrivateCloudDocuments } from "@/domain/private-cloud-merge";
import { ACCOUNT_PHOTO_MAX_BASE64 } from "@/domain/account-photo";

vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "photo" }));
vi.mock("@/features/settings/calendar-background-storage", () => ({
  loadCalendarBackground: async () => null,
  loadCalendarBackgroundStrength: async () => "medium",
  CALENDAR_BACKGROUND_KEY: "calendar_background_image",
  CALENDAR_BACKGROUND_STRENGTH_KEY: "calendar_background_strength",
}));
const photo = "/9j/AAAA";
const replacement = "/9j/BBBB";
const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
let memory: TariffAnnualTestDatabase;
function local() {
  return createPrivateCloudLocal(memory.db, {
    sha256,
    readPresentation: readCloudPresentation,
    preparePresentation: (value) => prepareCloudPresentation(memory.db, value),
    beforeReplace: async () => undefined,
    recoverNotifications: async () => undefined,
  });
}
beforeEach(async () => {
  memory = new TariffAnnualTestDatabase();
  await memory.setup();
  await migratePrivateCloud(memory.db);
});
afterEach(() => memory.database.close());

describe("private account photo", () => {
  it("persists locally, isolates owners and keeps images out of general backup preferences", async () => {
    const port = local();
    await port.bind("a", () => true);
    await saveAccountPhoto(memory.db, "a", photo, () => true);
    expect(await loadAccountPhoto(memory.db, "a")).toBe(photo);
    expect(await loadAccountPhoto(memory.db, "b")).toBeUndefined();
    const document = await port.capture();
    expect(document.presentation.accountPhoto).toBe(photo);
    expect(JSON.stringify(document.data.preferences)).not.toContain(photo);
    await port.bind("b", () => true);
    expect((await port.capture()).presentation.accountPhoto).toBeUndefined();
  });
  it("round-trips an incoming photo and explicit deletion through the atomic cloud restore", async () => {
    const port = local();
    await port.bind("a", () => true);
    for (const image of [photo, replacement, null]) {
      const expected = await port.capture();
      const document = {
        ...expected,
        presentation: { ...expected.presentation, accountPhoto: image },
      };
      expect(
        await port.apply(
          "a",
          expected,
          { revision: 1, updatedAt: "2026-10-29T12:00:00Z", document },
          () => true,
        ),
      ).toBe(true);
      expect(await loadAccountPhoto(memory.db, "a")).toBe(image);
      expect((await port.capture()).presentation.accountPhoto).toBe(image);
    }
  });
  it("does not overwrite a photo selected while a cloud response was in flight", async () => {
    const port = local();
    await port.bind("a", () => true);
    const expected = await port.capture();
    await saveAccountPhoto(memory.db, "a", photo, () => true);
    const document = {
      ...expected,
      presentation: { ...expected.presentation, accountPhoto: replacement },
    };
    expect(
      await port.apply(
        "a",
        expected,
        { revision: 1, updatedAt: "2026-10-29T12:00:00Z", document },
        () => true,
      ),
    ).toBe(false);
    expect(await loadAccountPhoto(memory.db, "a")).toBe(photo);
  });
  it("rolls back when the account changes during a save", async () => {
    await writeAccountPhoto(memory.db, "a", photo);
    let checks = 0;
    await expect(
      saveAccountPhoto(memory.db, "a", replacement, () => ++checks === 1),
    ).rejects.toThrow("Konto");
    expect(await loadAccountPhoto(memory.db, "a")).toBe(photo);
  });
  it("preserves photos when old clients omit them, but merges explicit removal", async () => {
    const port = local();
    await port.bind("a", () => true);
    const old = await port.capture();
    const base = { ...old, presentation: { ...old.presentation, accountPhoto: photo } };
    const removed = { ...base, presentation: { ...base.presentation, accountPhoto: null } };
    expect(mergePrivateCloudDocuments(base, base, old).document.presentation.accountPhoto).toBe(
      photo,
    );
    expect(
      mergePrivateCloudDocuments(base, old, removed).document.presentation.accountPhoto,
    ).toBeNull();
    const changed = { ...base, presentation: { ...base.presentation, accountPhoto: replacement } };
    expect(mergePrivateCloudDocuments(base, changed, removed).conflicts).toContain(
      "presentation.accountPhoto",
    );
    await writeAccountPhoto(memory.db, "a", photo);
    await (await prepareCloudPresentation(memory.db, old.presentation)).apply(memory.db);
    expect(await loadAccountPhoto(memory.db, "a")).toBe(photo);
  });
  it.each([
    "https://example.test/photo.jpg",
    "file:///private.jpg",
    12,
    {},
    "/9j/A",
    "/9j/" + "A".repeat(ACCOUNT_PHOTO_MAX_BASE64),
  ])("rejects malformed or oversized cloud images (%#)", async (accountPhoto) => {
    const base = await local().capture();
    await expect(
      validatePrivateCloudDocument(
        { ...base, presentation: { ...base.presentation, accountPhoto } },
        LATEST_DATABASE_SCHEMA_VERSION,
        sha256,
      ),
    ).rejects.toThrow("Cloud-Stand");
  });
});
