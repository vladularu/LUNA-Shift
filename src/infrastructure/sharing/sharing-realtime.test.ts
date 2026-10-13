import { expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { watchSharingChanges } from "./sharing-realtime";
const session = (id: string) => ({ user: { id }, access_token: `token-${id}` }) as Session;
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture() {
  let auth: (_event: string, value: Session | null) => void = () => {};
  const connections: { topic: string; event: () => void; status: (status: string) => void }[] = [];
  const unsubscribe = vi.fn();
  const client = {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        auth = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
      getSession: vi.fn(async () => ({ data: { session: session("a") } })),
    },
    realtime: { setAuth: vi.fn(async () => {}) },
    removeChannel: vi.fn(async () => "ok"),
    channel: vi.fn((topic) => {
      const connection = { topic, event: () => {}, status: (_status: string) => {} };
      connections.push(connection);
      const channel = {
        on: vi.fn((_kind, _options, callback) => {
          connection.event = callback;
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          connection.status = callback;
          return channel;
        }),
      };
      return channel;
    }),
  };
  const invalidate = vi.fn();
  const stop = watchSharingChanges(client as unknown as SupabaseClient, invalidate);
  return {
    client,
    invalidate,
    connections,
    stop,
    unsubscribe,
    auth: (value: Session | null) => auth("SIGNED_IN", value),
  };
}
it("uses a private user topic and reconciles on events and subscription recovery", async () => {
  const f = fixture();
  await flush();
  expect(f.client.channel).toHaveBeenCalledWith("sharing:a", { config: { private: true } });
  f.connections[0].event();
  f.connections[0].status("SUBSCRIBED");
  expect(f.invalidate).toHaveBeenCalledTimes(2);
  f.stop();
  f.connections[0].event();
  expect(f.invalidate).toHaveBeenCalledTimes(2);
  expect(f.unsubscribe).toHaveBeenCalledOnce();
});
it("ignores a former account's messages and removes its subscription", async () => {
  const f = fixture();
  await flush();
  f.auth(session("b"));
  await flush();
  f.connections[0].event();
  expect(f.invalidate).not.toHaveBeenCalled();
  expect(f.connections[1].topic).toBe("sharing:b");
  f.connections[1].event();
  expect(f.invalidate).toHaveBeenCalledOnce();
  f.auth(null);
  await flush();
  f.connections[1].event();
  expect(f.invalidate).toHaveBeenCalledOnce();
  f.stop();
});
it("does not install a pending auth subscription after disposal", async () => {
  const f = fixture();
  f.stop();
  await flush();
  expect(f.client.channel).not.toHaveBeenCalled();
});
