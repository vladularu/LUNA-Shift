import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";

const native = vi.hoisted(() => ({
  files: new Set<string>(),
  deleted: [] as string[],
  key: vi.fn(async (): Promise<string | null> => "a".repeat(64)),
  open: vi.fn(),
  close: vi.fn(async () => {}),
  cipher: vi.fn(async () => {}),
  quick: vi.fn(async () => {}),
  integrity: vi.fn(async () => {}),
  marker: vi.fn(async () => {}),
  migrate: vi.fn(async () => {}),
  purge: vi.fn(async () => {}),
  checkpoint: vi.fn(async () => {}),
}));
vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "standalone" },
  ExecutionEnvironment: { StoreClient: "storeClient" },
}));
vi.mock("expo-crypto", () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: native.key,
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(
      _directory: string,
      readonly name: string,
    ) {}
    get exists() {
      return native.files.has(this.name);
    }
    delete() {
      native.deleted.push(this.name);
      native.files.delete(this.name);
    }
  },
  Paths: {},
}));
vi.mock("expo-sqlite", () => ({ defaultDatabaseDirectory: "db", openDatabaseAsync: native.open }));
vi.mock("./sqlcipher", () => ({
  applyAndVerifySqlCipher: native.cipher,
  assertQuickCheck: native.quick,
  assertCipherIntegrity: native.integrity,
}));
vi.mock("./database-migration-marker", () => ({
  assertDatabaseMigrationMarker: native.marker,
  writeDatabaseMigrationMarker: vi.fn(),
}));
vi.mock("./migrations", () => ({ migrateDatabase: native.migrate }));
vi.mock("./tombstone-retention", () => ({ purgeExpiredTombstones: native.purge }));
vi.mock("./database-copy-verification", () => ({
  checkpointWal: native.checkpoint,
  assertAttachedDatabaseCopy: vi.fn(),
}));
vi.mock("@/infrastructure/diagnostics", () => ({ recordDiagnostic: vi.fn() }));
let databaseModule: typeof import("./secure-database.native");
const SECURE_DATABASE_NAME = "pflegeshift-secure-v1.db";
const prepareSecureDatabase = () => databaseModule.prepareSecureDatabase();
const initializeSecureDatabase = (database: SQLiteDatabase) =>
  databaseModule.initializeSecureDatabase(database);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  delete (globalThis as { __pflegeshiftPrepareSecureDatabaseV1?: unknown })
    .__pflegeshiftPrepareSecureDatabaseV1;
  native.files.clear();
  native.files.add(SECURE_DATABASE_NAME);
  native.deleted.length = 0;
  native.key.mockResolvedValue("a".repeat(64));
  native.cipher.mockResolvedValue();
  native.quick.mockResolvedValue();
  native.integrity.mockResolvedValue();
  native.open.mockResolvedValue({ closeAsync: native.close });
  databaseModule = await import("./secure-database.native");
});

describe("encrypted native startup", () => {
  it("does not open a second connection on normal startup and retains all provider checks", async () => {
    await prepareSecureDatabase();
    expect(native.open).not.toHaveBeenCalled();
    const database = { closeAsync: native.close } as unknown as SQLiteDatabase;
    await initializeSecureDatabase(database);
    expect(native.cipher).toHaveBeenCalledExactlyOnceWith(database, "a".repeat(64));
    expect(native.quick).toHaveBeenCalledExactlyOnceWith(database);
    expect(native.integrity).toHaveBeenCalledExactlyOnceWith(database);
    expect(native.migrate).toHaveBeenCalledExactlyOnceWith(database);
    expect(native.integrity.mock.invocationCallOrder[0]).toBeLessThan(
      native.migrate.mock.invocationCallOrder[0],
    );
    expect(native.deleted).toEqual([]);
  });

  it("blocks missing encryption keys without opening or changing the database", async () => {
    native.key.mockResolvedValue(null);
    await expect(prepareSecureDatabase()).rejects.toThrow();
    expect(native.open).not.toHaveBeenCalled();
    expect(native.deleted).toEqual([]);
  });

  it.each(["cipher", "quick", "integrity"] as const)(
    "closes and rejects the provider connection when %s validation fails",
    async (check) => {
      await prepareSecureDatabase();
      native[check].mockRejectedValueOnce(new Error("invalid encrypted database"));
      await expect(
        initializeSecureDatabase({ closeAsync: native.close } as unknown as SQLiteDatabase),
      ).rejects.toThrow();
      expect(native.close).toHaveBeenCalledTimes(1);
      expect(native.migrate).not.toHaveBeenCalled();
      expect(native.deleted).toEqual([]);
    },
  );

  it("validates before deleting temporary recovery artifacts", async () => {
    native.files.add("pflegeshift-secure-v1.tmp.db");
    await prepareSecureDatabase();
    expect(native.open).toHaveBeenCalledExactlyOnceWith(SECURE_DATABASE_NAME);
    expect(native.quick).toHaveBeenCalledTimes(1);
    expect(native.integrity).toHaveBeenCalledTimes(1);
    expect(native.deleted).toEqual(["pflegeshift-secure-v1.tmp.db"]);
  });

  it("retains recovery artifacts when preflight integrity fails", async () => {
    native.files.add("pflegeshift-secure-v1.tmp.db");
    native.integrity.mockRejectedValueOnce(new Error("corrupt"));
    await expect(prepareSecureDatabase()).rejects.toThrow();
    expect(native.deleted).toEqual([]);
  });
});
