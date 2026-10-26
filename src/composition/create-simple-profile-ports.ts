import type { SaveProfileInput } from "@/domain/types";
import { listRemunerationProfiles } from "@/infrastructure/database/remuneration-profile-repository";
import type { SQLiteDatabase } from "expo-sqlite";
import { createProfilePorts } from "./create-profile-ports";
import { projectStoredSimpleProfile } from "@/infrastructure/database/simple-app-profile";

/** Normal app reads only the simple view; archived repositories remain unchanged. */
export function createSimpleProfilePorts(db: SQLiteDatabase) {
  const ports = createProfilePorts(db);
  return {
    ...ports,
    repository: {
      ...ports.repository,
      saveProfile: async (input: SaveProfileInput) => {
        const profile = (await projectStoredSimpleProfile(
          db,
          await ports.repository.saveProfile(input),
        ))!;
        return { ...profile, employmentTimeline: await listRemunerationProfiles(db) };
      },
      loadProfile: async () => {
        const profile = await projectStoredSimpleProfile(db, await ports.repository.loadProfile());
        return profile
          ? { ...profile, employmentTimeline: await listRemunerationProfiles(db) }
          : null;
      },
    },
  };
}
