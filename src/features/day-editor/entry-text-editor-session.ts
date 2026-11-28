import { router } from "expo-router";
import { Keyboard } from "react-native";

export type EntryTextKind = "title" | "note";

interface EntryTextRequest {
  readonly id: string;
  readonly kind: EntryTextKind;
  readonly value: string;
  readonly onConfirm: (value: string) => void;
}

let nextId = 0;
let pending: EntryTextRequest | undefined;

export function openEntryTextEditor(
  kind: EntryTextKind,
  value: string,
  onConfirm: (value: string) => void,
): void {
  const id = String(++nextId);
  pending = { id, kind, value, onConfirm };
  Keyboard.dismiss();
  router.push({ pathname: "/entry-text-editor", params: { request: id } } as never);
}

export function pendingEntryTextEditor(id: unknown): EntryTextRequest | undefined {
  return pending?.id === id ? pending : undefined;
}

export function clearEntryTextEditorRequest(id: unknown): void {
  if (pending?.id === id) pending = undefined;
}
