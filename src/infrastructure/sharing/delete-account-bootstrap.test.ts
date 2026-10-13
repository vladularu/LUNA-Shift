import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** Deployment uses a5MiB server-side bundle limit; npm VFS recursively includes full packages. */
describe("sharing deletion bootstrap packaging", () => {
  it("keeps the Edge-only SDK import pinned and prebundled, without npm VFS", async () => {
    const source = await readFile(
      new URL("../../../supabase/functions/sharing-delete-account/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'from "https://esm.sh/@supabase/supabase-js@2.117.3?bundle&target=deno"',
    );
    expect(source).not.toMatch(/from\s+["']npm:/);
    expect(source).toContain('from "./handler.ts"');
    expect(source).toContain('from "./apple.ts"');
  });
  it("retains authenticated actor/session checks and caller-only administrative deletion", async () => {
    const source = await readFile(
      new URL("../../../supabase/functions/sharing-delete-account/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("admin.auth.getUser(accessToken)");
    expect(source).toContain('caller.rpc("sharing_list_calendars")');
    expect(source).toContain("admin.auth.admin.deleteUser(userId, false)");
  });
});
