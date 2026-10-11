import type { NetPayPension } from "@/domain/net-pay";
import type { NetPayPensionScheme } from "@/domain/net-pay-automation";
import type { KnownNetPayPensionScheme } from "@/domain/net-pay-pension-schemes";
import { NET_PAY_PENSION_RULES_2026 } from "./net-pay-pension-rules-2026";

const rate = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);

/** 2026, monthly distribution of allowances, no other tax-exempt pension contributions. */
export function calculateNetPayPension2026(
  scheme: NetPayPensionScheme,
  contributionBasisCents: number,
  employeeRateBps?: number,
): NetPayPension {
  if (
    !Number.isSafeInteger(contributionBasisCents) ||
    contributionBasisCents < 0 ||
    contributionBasisCents > 10_000_000
  )
    throw new Error("Die Zusatzversorgungsgrundlage ist ungültig.");
  if (scheme === "OTHER")
    throw new Error("Für diese Zusatzversorgung fehlen die Beitrags- und Steuerregeln.");
  if (scheme === "NONE")
    return {
      scheme,
      contributionBasisCents,
      employeeCents: 0,
      taxableAdjustmentCents: 0,
      socialInsuranceAdjustmentCents: 0,
    };
  if (!Object.hasOwn(NET_PAY_PENSION_RULES_2026, scheme))
    throw new Error("Die Zusatzversorgung ist ungültig.");
  const rules = NET_PAY_PENSION_RULES_2026[scheme as KnownNetPayPensionScheme];
  if (
    rules.sharedCapitalBps !== undefined
      ? employeeRateBps === undefined ||
        !Number.isSafeInteger(employeeRateBps) ||
        employeeRateBps < 0 ||
        employeeRateBps > rules.sharedCapitalBps / 2
      : employeeRateBps !== undefined
  )
    throw new Error("Der Eigenanteil der Zusatzversorgung fehlt oder ist ungültig.");
  // Higher VBL/KZVK remuneration can trigger extra contributions and special limits.
  if (contributionBasisCents > 897_396)
    throw new Error("Für dieses Entgelt müssen zusätzliche Versorgungsbeiträge geprüft werden.");
  const ownRate = rules.sharedCapitalBps === undefined ? rules.employeeBps : employeeRateBps!;
  const employeeCents = rate(contributionBasisCents, ownRate);
  const employerCapital = rate(
    contributionBasisCents,
    rules.sharedCapitalBps === undefined
      ? rules.employerCapitalBps
      : rules.sharedCapitalBps - ownRate,
  );
  const employeeCapital = rate(
    contributionBasisCents,
    rules.sharedCapitalBps === undefined ? rules.employeeCapitalBps : ownRate,
  );
  const employeeTaxFree = Math.min(employeeCapital, Math.max(0, 67_600 - employerCapital));
  const employerTaxable = Math.max(0, employerCapital - 67_600);
  const employeeSvFree = Math.min(employeeCapital, Math.max(0, 33_800 - employerCapital));
  const employerSvLiable = Math.max(0, employerCapital - 33_800);
  const umlageBps = rules.employerUmlageBps;
  const umlage = rate(contributionBasisCents, umlageBps);
  // §3 Nr56: §3 Nr63 capital contributions consume the shared allowance first.
  const umlageTaxFree = Math.min(umlage, Math.max(0, 33_800 - employerCapital - employeeTaxFree));
  const umlageTaxable = Math.max(0, umlage - umlageTaxFree - rules.flatTaxAllowanceCents);
  const exemptUmlage = umlage - umlageTaxable;
  const cappedUmlage = Math.min(exemptUmlage, 10_000);
  const hinzurechnung =
    umlageBps === 0
      ? 0
      : Math.max(0, Math.round((cappedUmlage * Math.min(250, umlageBps)) / umlageBps) - 1_330);
  const umlageSv = umlageTaxable + Math.max(0, exemptUmlage - 10_000) + hinzurechnung;
  return Object.freeze({
    scheme,
    contributionBasisCents,
    employeeCents,
    taxableAdjustmentCents: employerTaxable - employeeTaxFree + umlageTaxable,
    socialInsuranceAdjustmentCents: employerSvLiable - employeeSvFree + umlageSv,
  });
}
