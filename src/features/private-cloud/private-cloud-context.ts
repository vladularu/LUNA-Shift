import { createContext, useContext } from "react";
import type {
  createPrivateCloudRuntime,
  PrivateCloudStatus,
} from "@/application/private-cloud-runtime";
import type { SharingAuthUser } from "@/infrastructure/auth/sharing-auth";

export type PrivateCloudRuntime = ReturnType<typeof createPrivateCloudRuntime>;
export const PrivateCloudContext = createContext<{
  readonly user: SharingAuthUser | null;
  readonly status: PrivateCloudStatus;
  readonly runtime: PrivateCloudRuntime;
  readonly refreshAccount: () => Promise<void>;
  readonly saveName: (
    expectedAccountId: string,
    givenName: string,
    familyName: string,
  ) => Promise<void>;
  readonly ready: boolean;
  readonly initializationError: string | null;
} | null>(null);
export function usePrivateCloud() {
  const value = useContext(PrivateCloudContext);
  if (!value) throw new Error("Das Cloud-Konto ist hier nicht verfügbar.");
  return value;
}
