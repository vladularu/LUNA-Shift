import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3?bundle&target=deno";
import { createDeleteAccountHandler } from "./handler.ts";
import { createAppleRevoker } from "./apple.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !publicKey || !serviceKey) {
  Deno.serve(() =>
    Response.json(
      { code: "SHARE_DELETE_FAILED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    ),
  );
} else {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const revokeApple = createAppleRevoker(
    {
      teamId: Deno.env.get("SHARING_APPLE_TEAM_ID") ?? "",
      keyId: Deno.env.get("SHARING_APPLE_KEY_ID") ?? "",
      clientId: Deno.env.get("SHARING_APPLE_CLIENT_ID") ?? "",
      privateKey: (Deno.env.get("SHARING_APPLE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n"),
    },
    {
      fetch,
      now: () => Math.floor(Date.now() / 1000),
      crypto,
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    },
  );
  Deno.serve(
    createDeleteAccountHandler({
      async getUser(accessToken) {
        const { data, error } = await admin.auth.getUser(accessToken);
        if (error) throw new Error("SHARE_UNAUTHENTICATED");
        return data.user;
      },
      async validateSession(accessToken) {
        const caller = createClient(url, publicKey, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        // SQL actor_guard checks auth.sessions/session_id, current user and bans; getUser alone is insufficient.
        const { error } = await caller.rpc("sharing_list_calendars");
        if (error) throw new Error("SHARE_UNAUTHENTICATED");
      },
      revokeApple,
      async deleteUser(userId) {
        const { error } = await admin.auth.admin.deleteUser(userId, false);
        if (error) throw new Error("SHARE_DELETE_FAILED");
      },
    }),
  );
}
