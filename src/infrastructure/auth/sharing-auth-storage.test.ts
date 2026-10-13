import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createChunkedAuthStorage } from "./sharing-auth-storage";

function setup() {
  const values = new Map<string, string>();
  const store = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const digest = async (text: string) => createHash("sha256").update(text).digest("hex");
  return { values, store, storage: createChunkedAuthStorage(store, digest) };
}

describe("sharing authentication storage", () => {
  it("restores a large Unicode session with each native value below 2KB", async () => {
    const { storage, values } = setup();
    const value = JSON.stringify({ refresh_token: "x".repeat(7000), name: "🌙".repeat(600) });
    await storage.setItem("sb-test-auth-token", value);
    expect(await storage.getItem("sb-test-auth-token")).toBe(value);
    expect([...values.values()].every((entry) => Buffer.byteLength(entry) < 2048)).toBe(true);
  });

  it("cleans the previous generation when refreshing tokens", async () => {
    const { storage, values } = setup();
    await storage.setItem("session", "a".repeat(5000));
    await storage.setItem("session", "b".repeat(600));
    expect(await storage.getItem("session")).toBe("b".repeat(600));
    expect([...values.values()].some((entry) => entry.includes("a".repeat(50)))).toBe(false);
  });

  it("preserves the previous session if a chunk write fails", async () => {
    const { storage, store } = setup();
    await storage.setItem("session", "previous");
    store.set.mockImplementationOnce(async () => {
      throw new Error("keychain unavailable");
    });
    await expect(storage.setItem("session", "next")).rejects.toThrow();
    expect(await storage.getItem("session")).toBe("previous");
  });

  it("fails closed and cleans corrupted sessions", async () => {
    const { storage, values } = setup();
    await storage.setItem("session", "secret".repeat(400));
    const chunk = [...values.keys()].find((key) => /\.chunk\.0$/.test(key))!;
    values.set(chunk, "tampered");
    expect(await storage.getItem("session")).toBeNull();
    expect(values.size).toBe(0);
  });

  it("cleans bounded slots when a manifest is malformed", async () => {
    const { storage, values } = setup();
    await storage.setItem("session", "secret");
    const manifest = [...values.keys()].find((key) => key.endsWith(".manifest"))!;
    values.set(manifest, '{"v":1,"slot":"a","count":999999}');
    expect(await storage.getItem("session")).toBeNull();
    expect(values.size).toBe(0);
  });

  it("does not accept unbounded data or unsafe native keys", async () => {
    const { storage, values } = setup();
    await expect(storage.setItem("session", "x".repeat(65537))).rejects.toThrow();
    await expect(storage.setItem("../database-key", "secret")).rejects.toThrow();
    expect(values.size).toBe(0);
  });

  it("serializes refresh and sign-out without leaving tokens behind", async () => {
    const { storage, values } = setup();
    await Promise.all([storage.setItem("session", "new session"), storage.removeItem("session")]);
    expect(await storage.getItem("session")).toBeNull();
    expect(values.size).toBe(0);
  });
});

it("preserves Unicode when a surrogate pair crosses a native chunk boundary", async () => {
  const { storage, store, values } = setup();
  store.set.mockImplementation(async (key, value) => {
    values.set(key, Buffer.from(value).toString("utf8"));
  });
  const value = "a".repeat(511) + "🌙" + "b".repeat(4000);
  await storage.setItem("session", value);
  expect(await storage.getItem("session")).toBe(value);
});

it("cleans abandoned staged chunks if the process ended before the manifest committed", async () => {
  const { storage, values } = setup();
  values.set("session.luna-v1.a", '{"v":1,"count":1}');
  values.set("session.luna-v1.a.chunk.0", "orphan secret");
  expect(await storage.getItem("session")).toBeNull();
  expect(values.size).toBe(0);
});
