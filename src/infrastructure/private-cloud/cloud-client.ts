import type { SupabaseClient } from "@supabase/supabase-js";
import { UserFacingError } from "@/domain/errors";
import {
  PrivateCloudConflictError,
  type PrivateCloudRemote,
  type PrivateCloudRevision,
} from "@/domain/private-cloud";

export function createPrivateCloudClient(
  client: SupabaseClient,
  validate: (value: unknown) => Promise<PrivateCloudRevision["document"]>,
): PrivateCloudRemote {
  async function call(name: string, accountId: string, args: Record<string, unknown> = {}) {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // The RPC verifies both the current server session and p_expected_actor.
      const request = client
        .rpc(name, { p_expected_actor: accountId, ...args })
        .abortSignal(controller.signal);
      const result = await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            controller.abort();
            reject(new Error("Cloud request timeout"));
          }, 20000);
        }),
      ]);
      if (result.error?.message === "CLOUD_REVISION_CONFLICT")
        throw new PrivateCloudConflictError();
      if (result.error) throw new Error("Cloud request failed");
      return result.data as unknown;
    } catch (error) {
      if (error instanceof PrivateCloudConflictError) throw error;
      throw new UserFacingError(
        "Die Cloud ist gerade nicht erreichbar. Deine Daten bleiben auf diesem Gerät.",
      );
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
  }
  async function revision(value: unknown): Promise<PrivateCloudRevision> {
    if (!value || typeof value !== "object") throw new Error("Die Cloud-Antwort ist ungültig.");
    const record = value as PrivateCloudRevision;
    if (
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1 ||
      typeof record.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(record.updatedAt))
    )
      throw new Error("Die Cloud-Antwort ist ungültig.");
    return {
      revision: record.revision,
      updatedAt: record.updatedAt,
      document: await validate(record.document),
    };
  }
  return {
    async head(accountId) {
      const value = await call("private_cloud_head", accountId);
      if (value === null) return null;
      if (!value || typeof value !== "object") throw new Error("Invalid cloud head");
      const record = value as PrivateCloudRevision;
      if (
        !Number.isSafeInteger(record.revision) ||
        record.revision < 1 ||
        typeof record.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(record.updatedAt))
      )
        throw new Error("Invalid cloud head");
      return { revision: record.revision, updatedAt: record.updatedAt };
    },
    async read(accountId, number) {
      const data = await call("private_cloud_read", accountId, { p_revision: number ?? null });
      return data === null ? null : revision(data);
    },
    async write(input) {
      return revision(
        await call("private_cloud_write", input.accountId, {
          p_expected_revision: input.expectedRevision,
          p_mutation_id: input.mutationId,
          p_document: input.document,
        }),
      );
    },
    async history(accountId) {
      const data = await call("private_cloud_history", accountId);
      if (
        !Array.isArray(data) ||
        data.length > 31 ||
        data.some(
          (item) =>
            !item ||
            !Number.isSafeInteger(item.revision) ||
            item.revision < 1 ||
            typeof item.updatedAt !== "string" ||
            !Number.isFinite(Date.parse(item.updatedAt)),
        )
      )
        throw new Error("Die Sicherungsliste ist ungültig.");
      return data.map((item) => ({
        revision: item.revision as number,
        updatedAt: item.updatedAt as string,
      }));
    },
  };
}
