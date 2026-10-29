import canonicalize from "canonicalize";

import { PRIVATE_CLOUD_ROW_KEYS, type CloudJson, type PrivateCloudDocument } from "./private-cloud";

export function sameCloudValue(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function object(value: CloudJson | undefined): value is Readonly<Record<string, CloudJson>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rowsById(rows: readonly CloudJson[], keys: readonly string[]): Map<string, CloudJson> {
  const result = new Map<string, CloudJson>();
  for (const row of rows) {
    if (!object(row) || keys.some((key) => !(key in row)))
      throw new Error("Der Cloud-Datensatz enthält keinen eindeutigen Schlüssel.");
    const id = canonicalize(keys.map((key) => row[key]));
    if (id === undefined || result.has(id))
      throw new Error("Der Cloud-Datensatz enthält doppelte Schlüssel.");
    result.set(id, row);
  }
  return result;
}

export function normalizePrivateCloudDocument(
  document: PrivateCloudDocument,
): PrivateCloudDocument {
  const data: Record<string, CloudJson> = {};
  for (const [name, value] of Object.entries(document.data)) {
    const keys = PRIVATE_CLOUD_ROW_KEYS[name];
    data[name] =
      keys && Array.isArray(value)
        ? [...rowsById(value, keys)]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([, row]) => row)
        : value;
  }
  return { ...document, data };
}

/** Three-way merge. Device clocks never choose the winner of a user-data conflict. */
export function mergePrivateCloudDocuments(
  base: PrivateCloudDocument,
  local: PrivateCloudDocument,
  remote: PrivateCloudDocument,
): { readonly document: PrivateCloudDocument; readonly conflicts: readonly string[] } {
  // Old clients omit this field when capturing. Omission is not a user deletion.
  const compatible = (value: PrivateCloudDocument): PrivateCloudDocument =>
    value.presentation.accountPhoto === undefined && base.presentation.accountPhoto !== undefined
      ? {
          ...value,
          presentation: { ...value.presentation, accountPhoto: base.presentation.accountPhoto },
        }
      : value;
  local = compatible(local);
  remote = compatible(remote);
  const conflicts: string[] = [];
  function merge(
    before: CloudJson | undefined,
    device: CloudJson | undefined,
    cloud: CloudJson | undefined,
    path: string,
  ): CloudJson | undefined {
    if (sameCloudValue(device, cloud) || sameCloudValue(before, cloud)) return device;
    if (sameCloudValue(before, device)) return cloud;
    const arrayKeys = PRIVATE_CLOUD_ROW_KEYS[path.replace(/^data\./, "")];
    if (arrayKeys && Array.isArray(before) && Array.isArray(device) && Array.isArray(cloud)) {
      const previous = rowsById(before, arrayKeys);
      const current = rowsById(device, arrayKeys);
      const incoming = rowsById(cloud, arrayKeys);
      return [...new Set([...previous.keys(), ...current.keys(), ...incoming.keys()])]
        .sort()
        .flatMap((id) => {
          const value = merge(previous.get(id), current.get(id), incoming.get(id), `${path}.${id}`);
          return value === undefined ? [] : [value];
        });
    }
    if (object(device) && object(cloud) && (object(before) || before === undefined)) {
      const previous = object(before) ? before : {};
      if (
        object(before) &&
        "deleted_at" in before &&
        ((device.deleted_at !== before.deleted_at && cloud.deleted_at === before.deleted_at) ||
          (cloud.deleted_at !== before.deleted_at && device.deleted_at === before.deleted_at))
      ) {
        conflicts.push(path);
        return device;
      }
      const output: Record<string, CloudJson> = {};
      for (const key of new Set([
        ...Object.keys(previous),
        ...Object.keys(device),
        ...Object.keys(cloud),
      ])) {
        // Metadata is merged only after the actual fields; it cannot discard a user edit.
        let value: CloudJson | undefined;
        if (
          key === "revision" &&
          typeof device[key] === "number" &&
          typeof cloud[key] === "number"
        ) {
          value = Math.max(device[key], cloud[key]);
        } else if (
          (key === "updated_at" || key === "created_at") &&
          typeof device[key] === "string" &&
          typeof cloud[key] === "string"
        ) {
          value = [device[key], cloud[key]].sort()[key === "created_at" ? 0 : 1];
        } else {
          value = merge(previous[key], device[key], cloud[key], path ? `${path}.${key}` : key);
        }
        if (value !== undefined) output[key] = value;
      }
      return output;
    }
    conflicts.push(path);
    return device;
  }
  const document = merge(
    base as unknown as CloudJson,
    local as unknown as CloudJson,
    remote as unknown as CloudJson,
    "",
  ) as unknown as PrivateCloudDocument;
  return { document, conflicts };
}
