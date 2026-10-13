/** SecureStore values are bounded below iOS's historical 2KB limit, including Unicode. */
export const AUTH_STORAGE_MAX_CHARS = 65_536;
const CHUNK_CHARS = 512;
const MAX_CHUNKS = Math.ceil(AUTH_STORAGE_MAX_CHARS / (CHUNK_CHARS - 1));

type Slot = "a" | "b";
type Manifest = { v: 1; slot: Slot; count: number; length: number; checksum: string };
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export type NativeSecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

function countIsValid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CHUNKS;
}
function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value || value.length > 1024) return null;
  try {
    const result: unknown = JSON.parse(value);
    return result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
function parseManifest(value: string | null): Manifest | null {
  const parsed = parseJson(value);
  if (
    parsed?.v !== 1 ||
    (parsed.slot !== "a" && parsed.slot !== "b") ||
    !countIsValid(parsed.count) ||
    typeof parsed.length !== "number" ||
    !Number.isInteger(parsed.length) ||
    parsed.length < 0 ||
    parsed.length > AUTH_STORAGE_MAX_CHARS ||
    parsed.count < Math.ceil(parsed.length / CHUNK_CHARS) ||
    parsed.count > Math.ceil(parsed.length / (CHUNK_CHARS - 1)) ||
    typeof parsed.checksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.checksum)
  )
    return null;
  return parsed as Manifest;
}

/** Two slots keep the old session intact until all replacement chunks are committed. */
export function createChunkedAuthStorage(
  store: NativeSecretStore,
  sha256: (value: string) => Promise<string>,
): AuthStorage {
  const operations = new Map<string, Promise<unknown>>();
  function queued<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(key))
      return Promise.reject(new Error("Ungültiger Sitzungsschlüssel."));
    const previous = operations.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    operations.set(key, result);
    void result
      .finally(() => {
        if (operations.get(key) === result) operations.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
  const manifestKey = (key: string) => `${key}.luna-v1.manifest`;
  const slotKey = (key: string, slot: Slot) => `${key}.luna-v1.${slot}`;
  const chunkKey = (key: string, slot: Slot, index: number) =>
    `${slotKey(key, slot)}.chunk.${index}`;
  async function cleanSlot(key: string, slot: Slot) {
    const descriptorText = await store.get(slotKey(key, slot));
    if (descriptorText === null) return;
    const descriptor = parseJson(descriptorText);
    const count =
      descriptor?.v === 1 && countIsValid(descriptor.count) ? descriptor.count : MAX_CHUNKS;
    for (let index = 0; index < count; index++) await store.remove(chunkKey(key, slot, index));
    await store.remove(slotKey(key, slot));
  }
  async function remove(key: string) {
    await store.remove(manifestKey(key));
    await cleanSlot(key, "a");
    await cleanSlot(key, "b");
    await store.remove(key);
  }
  return {
    getItem: (key) =>
      queued(key, async () => {
        const raw = await store.get(manifestKey(key));
        if (raw === null) {
          await cleanSlot(key, "a");
          await cleanSlot(key, "b");
          return null;
        }
        const manifest = parseManifest(raw);
        if (!manifest) {
          await remove(key);
          return null;
        }
        const chunks: string[] = [];
        for (let index = 0; index < manifest.count; index++) {
          const chunk = await store.get(chunkKey(key, manifest.slot, index));
          if (chunk === null || chunk.length > CHUNK_CHARS) {
            await remove(key);
            return null;
          }
          chunks.push(chunk);
        }
        const value = chunks.join("");
        if (value.length !== manifest.length || (await sha256(value)) !== manifest.checksum) {
          await remove(key);
          return null;
        }
        return value;
      }),
    setItem: (key, value) =>
      queued(key, async () => {
        if (value.length > AUTH_STORAGE_MAX_CHARS)
          throw new Error("Die Sitzung ist zu groß für den sicheren Speicher.");
        const previous = parseManifest(await store.get(manifestKey(key)));
        const slot: Slot = previous?.slot === "a" ? "b" : "a";
        await cleanSlot(key, slot);
        const chunks: string[] = [];
        for (let start = 0; start < value.length;) {
          let end = Math.min(start + CHUNK_CHARS, value.length);
          const before = value.charCodeAt(end - 1);
          const after = value.charCodeAt(end);
          if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
          chunks.push(value.slice(start, end));
          start = end;
        }
        const count = chunks.length;
        const checksum = await sha256(value);
        try {
          await store.set(slotKey(key, slot), JSON.stringify({ v: 1, count }));
          for (let index = 0; index < count; index++)
            await store.set(chunkKey(key, slot, index), chunks[index]);
          await store.set(
            manifestKey(key),
            JSON.stringify({ v: 1, slot, count, length: value.length, checksum }),
          );
        } catch (error) {
          await cleanSlot(key, slot);
          throw error;
        }
        if (previous) await cleanSlot(key, previous.slot);
        await store.remove(key);
      }),
    removeItem: (key) => queued(key, () => remove(key)),
  };
}
