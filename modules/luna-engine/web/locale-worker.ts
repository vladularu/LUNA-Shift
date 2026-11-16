import { createRankState, dispatchRankCommand } from "../transport/locale/core";
const scope = globalThis as unknown as {
  postMessage(value: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};
const state = createRankState();
scope.onmessage = ({ data }) => {
  const message = data as Record<string, unknown> | null;
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).length !== 3 ||
    message.kind !== "COMMAND" ||
    !Number.isSafeInteger(message.id) ||
    (message.id as number) <= 0
  ) {
    scope.postMessage({ kind: "ERROR" });
    return;
  }
  scope.postMessage({
    kind: "REPLY",
    id: message.id,
    reply: dispatchRankCommand(state, message.command),
  });
};
scope.postMessage({ kind: "READY", version: 1 });
