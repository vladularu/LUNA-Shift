import { UserFacingError } from "./errors";

export type CloudJson =
  null | boolean | number | string | readonly CloudJson[] | { readonly [key: string]: CloudJson };

export interface PrivateCloudDocument {
  readonly format: "lunashift-private-cloud";
  readonly version: 1;
  readonly backupVersion: number;
  readonly databaseSchemaVersion: number;
  readonly data: Readonly<Record<string, CloudJson>>;
  readonly presentation: {
    readonly calendarImage: string | null;
    readonly calendarImageStrength: "subtle" | "medium" | "strong";
  };
}

export interface PrivateCloudRevision {
  readonly revision: number;
  readonly updatedAt: string;
  readonly document: PrivateCloudDocument;
}

export interface CloudDeviceState {
  readonly accountId: string;
  readonly baseline: PrivateCloudRevision | null;
  readonly pending: {
    readonly expectedRevision: number;
    readonly mutationId: string;
    readonly document: PrivateCloudDocument;
    readonly sourceDocument: PrivateCloudDocument;
  } | null;
}

export interface CloudLocalPort {
  state(): Promise<CloudDeviceState | null>;
  capture(): Promise<PrivateCloudDocument>;
  bind(accountId: string, isCurrent: () => boolean): Promise<void>;
  stage(
    accountId: string,
    pending: NonNullable<CloudDeviceState["pending"]>,
    isCurrent: () => boolean,
  ): Promise<void>;
  clearPending(accountId: string, isCurrent: () => boolean): Promise<void>;
  recovery(): Promise<PrivateCloudDocument | null>;
  apply(
    accountId: string,
    expected: PrivateCloudDocument,
    incoming: PrivateCloudRevision,
    isCurrent: () => boolean,
  ): Promise<boolean>;
}

export interface PrivateCloudRemote {
  head?(accountId: string): Promise<Pick<PrivateCloudRevision, "revision" | "updatedAt"> | null>;
  read(accountId: string, revision?: number): Promise<PrivateCloudRevision | null>;
  write(input: {
    readonly accountId: string;
    readonly expectedRevision: number;
    readonly mutationId: string;
    readonly document: PrivateCloudDocument;
  }): Promise<PrivateCloudRevision>;
  history(
    accountId: string,
  ): Promise<readonly Pick<PrivateCloudRevision, "revision" | "updatedAt">[]>;
}

export class PrivateCloudConflictError extends UserFacingError {
  constructor() {
    super("Deine Cloud wurde zwischenzeitlich geändert. Bitte gleiche erneut ab.");
    this.name = "PrivateCloudConflictError";
  }
}

export const PRIVATE_CLOUD_MAX_CHARACTERS = 16 * 1024 * 1024;

/** This allowlist follows the personal backup contract, never arbitrary SQLite tables. */
export const PRIVATE_CLOUD_ROW_KEYS: Readonly<Record<string, readonly string[]>> = {
  netPayProfiles: ["month"],
  remunerationProfiles: ["id"],
  allowanceDecisions: ["month"],
  overtimeAllocations: ["shift_id"],
  paidAbsences: ["shift_id"],
  trainingProfiles: ["effective_from"],
  shiftTrainingDetails: ["shift_id"],
  actualAnnualPayments: ["entitlement_year", "payment_id"],
  tariffAnnualClaims: ["entitlement_year", "claim_id"],
  tvlShiftWork: ["shift_id", "profile_effective_from"],
  caritasWorkDays: ["shift_id", "date"],
  caritasMonthFacts: ["month"],
  caritasOvertime: ["shift_id"],
  tvoedAnnexAMonthConfirmations: ["month"],
  tvoedSueMonthConfirmations: ["month"],
  tvoedSueAllowanceConfirmations: ["month"],
  tvoedAnnexAPremiumFacts: ["month"],
  drkEmployeeMonthConfirmations: ["month"],
  drkTrainingMonthConfirmations: ["month"],
  templates: ["id"],
  shifts: ["id"],
  appointments: ["id"],
  monthlyTariffDecisions: ["month"],
  preferences: ["key"],
};
