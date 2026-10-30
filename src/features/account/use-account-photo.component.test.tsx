import { act, renderHook, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SQLiteDatabase } from "expo-sqlite";
import type { PrivateCloudRuntime } from "@/features/private-cloud/private-cloud-context";
import { useAccountPhoto } from "./use-account-photo";

const mockLoad = jest.fn<(db: unknown, account: string) => Promise<string | null | undefined>>();
const mockSave =
  jest.fn<
    (db: unknown, account: string, photo: string | null, current: () => boolean) => Promise<void>
  >();
const mockPick =
  jest.fn<
    () => Promise<{ canceled: boolean; assets: { uri: string; width: number; height: number }[] }>
  >();
const mockEncode = jest.fn<() => Promise<{ uri: string; base64: string }>>();
const mockCrop = jest.fn();
const mockResize = jest.fn();
const mockRelease = jest.fn();
const mockDelete = jest.fn();
const mockSync = jest.fn<() => Promise<void>>();
let mockAccount: string | null = "a";
jest.mock("@/infrastructure/database/account-photo-repository", () => ({
  loadAccountPhoto: (...args: Parameters<typeof mockLoad>) => mockLoad(...args),
  saveAccountPhoto: (...args: Parameters<typeof mockSave>) => mockSave(...args),
}));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: () => mockPick() }));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      crop: mockCrop,
      resize: mockResize,
      release: mockRelease,
      renderAsync: async () => ({ saveAsync: mockEncode, release: mockRelease }),
    }),
  },
}));
jest.mock("expo-file-system", () => ({
  File: class {
    size = 100;
    exists = true;
    delete = mockDelete;
  },
}));
const db = {} as SQLiteDatabase;
const runtime = {
  isCurrentAccount: (id: string) => mockAccount === id,
  synchronize: mockSync,
} as unknown as PrivateCloudRuntime;
const selection = { canceled: false, assets: [{ uri: "file:///photo", width: 1200, height: 800 }] };
beforeEach(() => {
  jest.clearAllMocks();
  mockAccount = "a";
  mockLoad.mockResolvedValue("/9j/AAAA");
  mockSave.mockResolvedValue();
  mockPick.mockResolvedValue(selection);
  mockEncode.mockResolvedValue({ uri: "file:///cache", base64: "/9j/BBBB" });
  mockSync.mockResolvedValue();
});
async function open() {
  const hook = await renderHook(
    ({ id }: { id: string | null }) => useAccountPhoto(db, id, true, runtime),
    { initialProps: { id: "a" as string | null } },
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}
describe("account photo selection", () => {
  it("crops, persists and immediately displays the photo before cloud synchronization", async () => {
    const hook = await open();
    await act(() => hook.result.current.choose());
    expect(mockCrop).toHaveBeenCalledWith({ originX: 200, originY: 0, width: 800, height: 800 });
    expect(mockResize).toHaveBeenCalledWith({ width: 512, height: 512 });
    expect(mockSave).toHaveBeenCalledWith(db, "a", "/9j/BBBB", expect.any(Function));
    expect(hook.result.current.uri).toBe("data:image/jpeg;base64,/9j/BBBB");
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });
  it("keeps the current photo when selection is cancelled or saving fails", async () => {
    const hook = await open();
    mockPick.mockResolvedValueOnce({ canceled: true, assets: [] });
    await act(() => hook.result.current.choose());
    expect(mockSave).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeNull();
    mockSave.mockRejectedValueOnce(new Error("database details"));
    await act(() => hook.result.current.choose());
    expect(hook.result.current.uri).toBe("data:image/jpeg;base64,/9j/AAAA");
    expect(hook.result.current.error).toContain("nicht gespeichert");
    expect(hook.result.current.error).not.toContain("database");
    expect(mockSync).not.toHaveBeenCalled();
  });
  it("removes the photo locally and syncs a tombstone", async () => {
    const hook = await open();
    await act(() => hook.result.current.remove());
    expect(mockSave).toHaveBeenCalledWith(db, "a", null, expect.any(Function));
    expect(hook.result.current.uri).toBeNull();
    expect(mockPick).not.toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalled();
  });
  it("serializes selection and drops a result if the user switches accounts", async () => {
    const hook = await open();
    let resolve!: (value: typeof selection) => void;
    mockPick.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let operation!: Promise<void>;
    await act(async () => {
      operation = hook.result.current.choose();
    });
    await act(async () => {
      await hook.result.current.choose();
    });
    expect(mockPick).toHaveBeenCalledTimes(1);
    mockAccount = "b";
    mockLoad.mockResolvedValue(null);
    await hook.rerender({ id: "b" });
    expect(hook.result.current.uri).toBeNull();
    await act(async () => {
      resolve(selection);
      await operation;
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
  it("discards a stale load after logout", async () => {
    let resolve!: (value: string) => void;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = await renderHook(
      ({ id }: { id: string | null }) => useAccountPhoto(db, id, true, runtime),
      { initialProps: { id: "a" as string | null } },
    );
    mockAccount = null;
    await hook.rerender({ id: null });
    await act(async () => resolve("/9j/AAAA"));
    expect(hook.result.current.uri).toBeNull();
    expect(hook.result.current.ready).toBe(false);
  });
  it("retains the original on picker permission errors and invalid encoded images", async () => {
    const hook = await open();
    mockPick.mockRejectedValueOnce(new Error("permission denied"));
    await act(() => hook.result.current.choose());
    expect(hook.result.current.uri).toBe("data:image/jpeg;base64,/9j/AAAA");
    mockEncode.mockResolvedValueOnce({ uri: "file:///cache", base64: "bad-image" });
    await act(() => hook.result.current.choose());
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });
});
