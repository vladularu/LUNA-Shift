export const STANDBY_TARIFFS = ["TVOED_K", "TVOED_B", "TVL_43", "TVH_43", "TVUK"] as const;
export type StandbyTariff = (typeof STANDBY_TARIFFS)[number];

/** Facts from the employer's agreement, stored with the dated duty/template. */
export interface StandbyAgreement {
  readonly tariff: StandbyTariff;
  readonly rule: "UNKNOWN" | "STANDARD" | "CARE";
  readonly sequence: number | null;
  readonly payGroup: string | null;
  readonly rateMode: "TABLE" | "AGREED";
  readonly hourlyCents: number | null;
  readonly timeOffMode: "UNKNOWN" | "WEIGHTED" | "FACTORIZED";
}

export function newStandbyAgreement(tariff: StandbyTariff): StandbyAgreement {
  return {
    tariff,
    rule: "UNKNOWN",
    sequence: null,
    payGroup: null,
    rateMode: "TABLE",
    hourlyCents: null,
    timeOffMode: "UNKNOWN",
  };
}

export function validateStandbyAgreement(value: unknown): StandbyAgreement {
  const fail = (): never => {
    throw new Error("Bitte prüfe die Abrechnungsgrundlage der Bereitschaft.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  const keys = ["tariff", "rule", "sequence", "payGroup", "rateMode", "hourlyCents", "timeOffMode"];
  if (Object.keys(v).length !== keys.length || keys.some((key) => !(key in v))) return fail();
  if (
    !STANDBY_TARIFFS.includes(v.tariff as StandbyTariff) ||
    !["UNKNOWN", "STANDARD", "CARE"].includes(String(v.rule))
  )
    return fail();
  if (
    v.sequence !== null &&
    (typeof v.sequence !== "number" ||
      !Number.isInteger(v.sequence) ||
      v.sequence < 1 ||
      v.sequence > 100)
  )
    return fail();
  if (
    v.payGroup !== null &&
    (typeof v.payGroup !== "string" || !/^[A-Za-z0-9_Ü/-]{1,40}$/.test(v.payGroup))
  )
    return fail();
  if (
    v.hourlyCents !== null &&
    (typeof v.hourlyCents !== "number" ||
      !Number.isSafeInteger(v.hourlyCents) ||
      v.hourlyCents < 1 ||
      v.hourlyCents > 100000)
  )
    return fail();
  if (!["UNKNOWN", "WEIGHTED", "FACTORIZED"].includes(String(v.timeOffMode))) return fail();
  if (
    (v.rateMode !== "TABLE" && v.rateMode !== "AGREED") ||
    (v.rateMode === "TABLE" && v.hourlyCents !== null)
  )
    return fail();
  return Object.freeze({ ...v }) as unknown as StandbyAgreement;
}
