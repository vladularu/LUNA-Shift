import { UserFacingError } from "@/domain/errors";

export async function saveAccountName(
  ports: {
    readonly isCurrentAccount: (accountId: string) => boolean;
    readonly updateName: (
      accountId: string,
      givenName: string,
      familyName: string,
    ) => Promise<{ readonly displayName: string }>;
    readonly saveSharingName: (accountId: string, displayName: string) => Promise<unknown>;
    readonly refreshAccount: () => Promise<void>;
  },
  accountId: string,
  givenName: string,
  familyName: string,
) {
  const check = () => {
    if (!ports.isCurrentAccount(accountId))
      throw new UserFacingError("Dein Konto hat sich geändert. Bitte öffne die Namenseite erneut.");
  };
  check();
  const updated = await ports.updateName(accountId, givenName, familyName);
  check();
  await ports.saveSharingName(accountId, updated.displayName);
  check();
  await ports.refreshAccount();
}
