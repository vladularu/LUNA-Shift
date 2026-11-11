import { validateAnnualSalaryPayments } from "@/domain/annual-salary-payment";
import { isNetPayPensionScheme } from "@/domain/net-pay-pension-schemes";
import { SALARY_PAYMENT_GROUPS } from "@/domain/salary-payment";
import { validateProfile, validateShift } from "@/domain/validation";
import type { SaveProfileInput, SaveShiftInput } from "@/domain/types";
import { ALLOWANCE_STATUSES } from "@/domain/types";
import type { AnalysisSalaryRequest, PreparedAnalysisSalary } from "./analysis-salary";

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const month = (v: unknown): v is string => text(v) && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const fields = (v: Record<string, unknown>, keys: string[], accept = finite) =>
  keys.every((key) => accept(v[key]));
const list = (v: unknown, accept: (item: unknown) => boolean) =>
  Array.isArray(v) && v.every(accept);
const optional = (v: unknown, accept: (item: unknown) => boolean) => v === undefined || accept(v);

/** Producer-owned JSON only: reject values the shared codec cannot faithfully represent. */
function serializable(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (v === null || v === undefined || text(v) || typeof v === "boolean") return true;
  if (typeof v === "number") return finite(v);
  if (v instanceof Map)
    return [...v].every(
      ([key, child]) => serializable(key, depth + 1) && serializable(child, depth + 1),
    );
  if (Array.isArray(v)) return v.every((child) => serializable(child, depth + 1));
  return (
    record(v) &&
    Object.getPrototypeOf(v) === Object.prototype &&
    Object.values(v).every((child) => serializable(child, depth + 1))
  );
}

function profile(v: unknown): boolean {
  if (!record(v) || !text(v.timeZone) || !finite(v.weeklyMinutes)) return false;
  try {
    validateProfile(v as unknown as SaveProfileInput);
    return true;
  } catch {
    return false;
  }
}
function shift(v: unknown): boolean {
  if (!record(v) || v.kind !== "SHIFT" || !text(v.id) || !text(v.date) || !text(v.type))
    return false;
  try {
    validateShift(v as unknown as SaveShiftInput);
    return true;
  } catch {
    return false;
  }
}
const range = (v: unknown): boolean => record(v) && text(v.start) && text(v.end);
function trace(v: unknown): boolean {
  return (
    record(v) &&
    text(v.id) &&
    range(v) &&
    (v.unpaidBreaks === null || list(v.unpaidBreaks, range)) &&
    optional(v.paidBreaks, (items) => list(items, range)) &&
    list(
      v.payments,
      (p) =>
        record(p) &&
        text(p.id) &&
        ["NIGHT", "DAY", "OTHER"].includes(String(p.kind)) &&
        cents(p.amountCents) &&
        typeof p.additionalToBasicPay === "boolean" &&
        list(p.periods, range),
    )
  );
}
function pay(v: unknown): boolean {
  return (
    record(v) &&
    month(v.month) &&
    typeof v.available === "boolean" &&
    (v.tariffLabel === null || text(v.tariffLabel)) &&
    ["fullTimeTableAmount", "personalBaseAmount", "estimatedGrossAmount"].every(
      (k) => v[k] === null || finite(v[k]),
    ) &&
    fields(v, [
      "timePremiumAmount",
      "overtimeAmount",
      "allowanceAmount",
      "tvoedAllowanceAmount",
      "careAllowanceAmount",
    ]) &&
    optional(v.knownGrossAmount, finite) &&
    optional(v.specialDutyAmount, finite) &&
    optional(v.specialDutyBreakdowns, (items) => list(items, record)) &&
    optional(v.specialDutyNotes, (items) => list(items, text)) &&
    optional(v.nightCompensatoryMinutes, finite) &&
    (v.confirmedAllowance === null ||
      (ALLOWANCE_STATUSES as readonly unknown[]).includes(v.confirmedAllowance)) &&
    record(v.assessment) &&
    typeof v.assessment.requiresConfirmation === "boolean" &&
    ["DETECTED", "REVIEW", "NOT_DETECTED"].includes(String(v.assessment.shiftWork)) &&
    ["DETECTED", "REVIEW", "NOT_DETECTED"].includes(String(v.assessment.alternatingShiftWork)) &&
    list(v.assessment.evidence, text) &&
    list(
      v.assessment.criteria,
      (c) =>
        record(c) &&
        text(c.key) &&
        text(c.label) &&
        text(c.detail) &&
        ["MET", "OPEN", "NOT_MET"].includes(String(c.state)),
    ) &&
    list(
      v.shiftBreakdowns,
      (b) =>
        record(b) &&
        text(b.shiftId) &&
        text(b.date) &&
        fields(b, ["netMinutes", "overtimeBaseAmount", "overtimePremiumAmount", "totalAmount"]) &&
        optional(b.payrollTrace, trace) &&
        list(
          b.premiumLines,
          (line) =>
            record(line) &&
            text(line.key) &&
            text(line.label) &&
            fields(line, ["minutes", "percentage", "hourlyRate", "amount"]),
        ),
    )
  );
}
function contribution(v: unknown): boolean {
  return (
    record(v) &&
    [...SALARY_PAYMENT_GROUPS, "BASE", "CARE_ALLOWANCE", "TARIFF_ALLOWANCE"].includes(
      String(v.group),
    ) &&
    month(v.claimMonth) &&
    (v.paymentMonth === null || month(v.paymentMonth)) &&
    cents(v.amountCents)
  );
}
function projection(v: unknown, request?: AnalysisSalaryRequest): boolean {
  if (
    !record(v) ||
    !month(v.month) ||
    !["PAYOUT", "EARNED"].includes(String(v.perspective)) ||
    typeof v.available !== "boolean" ||
    !pay(v.pay) ||
    !record(v.pay) ||
    v.pay.month !== v.month ||
    !list(
      v.sources,
      (s) =>
        record(s) &&
        month(s.month) &&
        profile(s.profile) &&
        list(s.shifts, shift) &&
        pay(s.pay) &&
        record(s.pay) &&
        s.pay.month === s.month,
    ) ||
    !list(v.contributions, contribution) ||
    !optional(v.outgoingContributions, (items) => list(items, contribution)) ||
    !list(v.warnings, text) ||
    !list(
      v.issues,
      (issue) =>
        record(issue) &&
        ["UNCONFIGURED", "MISSING_MONTH", "UNAVAILABLE"].includes(String(issue.kind)) &&
        month(issue.month) &&
        text(issue.message) &&
        optional(issue.group, (group) =>
          SALARY_PAYMENT_GROUPS.includes(group as (typeof SALARY_PAYMENT_GROUPS)[number]),
        ),
    )
  )
    return false;
  if (!request) return true;
  return v.month === request.month && v.perspective === request.payment?.perspective;
}
function basis(v: unknown): boolean {
  return (
    record(v) &&
    fields(v, ["payrollYear", "rulesYear"], cents) &&
    text(v.revision) &&
    ["VERIFIED", "PREVIOUS_YEAR_ESTIMATE"].includes(String(v.status))
  );
}
const amounts = (v: unknown): boolean =>
  record(v) &&
  fields(
    v,
    [
      "grossCents",
      "taxableGrossCents",
      "socialInsuranceGrossCents",
      "regularMonthlySocialInsuranceGrossCents",
    ],
    cents,
  );
function net(v: unknown, expectedMonth?: string): boolean {
  if (
    !record(v) ||
    v.status !== "available" ||
    !month(v.month) ||
    (expectedMonth !== undefined && v.month !== expectedMonth) ||
    !text(v.ruleVersion) ||
    !optional(v.calculationBasis, basis) ||
    !amounts(v.amounts) ||
    !record(v.amounts) ||
    !record(v.tax) ||
    !fields(
      v.tax,
      ["wageTaxCents", "solidarityCents", "churchTaxBasisCents", "churchTaxCents", "totalCents"],
      cents,
    ) ||
    !record(v.socialInsurance) ||
    !fields(
      v.socialInsurance,
      [
        "healthBasisCents",
        "pensionBasisCents",
        "healthStandardCents",
        "healthAdditionalCents",
        "healthCents",
        "careCents",
        "pensionCents",
        "unemploymentCents",
        "totalCents",
      ],
      cents,
    ) ||
    !cents(v.netCents) ||
    !optional(v.additionalNetDeductionCents, cents) ||
    !optional(
      v.pension,
      (p) =>
        record(p) &&
        isNetPayPensionScheme(p.scheme) &&
        fields(
          p,
          [
            "contributionBasisCents",
            "employeeCents",
            "taxableAdjustmentCents",
            "socialInsuranceAdjustmentCents",
          ],
          cents,
        ),
    )
  )
    return false;
  const tax = v.tax,
    sv = v.socialInsurance;
  const pension = record(v.pension) ? Number(v.pension.employeeCents) : 0;
  return (
    tax.totalCents ===
      Number(tax.wageTaxCents) + Number(tax.solidarityCents) + Number(tax.churchTaxCents) &&
    sv.healthCents === Number(sv.healthStandardCents) + Number(sv.healthAdditionalCents) &&
    sv.totalCents ===
      Number(sv.healthCents) +
        Number(sv.careCents) +
        Number(sv.pensionCents) +
        Number(sv.unemploymentCents) &&
    v.netCents ===
      Number(v.amounts.grossCents) -
        Number(tax.totalCents) -
        Number(sv.totalCents) -
        pension -
        Number(v.additionalNetDeductionCents ?? 0)
  );
}
function classification(v: unknown): boolean {
  return (
    record(v) &&
    v.status === "available" &&
    text(v.ruleVersion) &&
    optional(v.calculationBasis, basis) &&
    ["PLANNED", "RECORDED"].includes(String(v.workEvidence)) &&
    amounts(v.amounts) &&
    fields(v, ["paidPremiumCents", "taxFreeCents", "socialInsuranceFreeCents"], cents) &&
    list(
      v.shifts,
      (s) =>
        record(s) &&
        text(s.shiftId) &&
        fields(
          s,
          [
            "workedMinutes",
            "nightMinutes",
            "dayMinutes",
            "paidPremiumCents",
            "taxFreeCents",
            "socialInsuranceFreeCents",
            "taxablePremiumCents",
            "socialInsuranceLiablePremiumCents",
          ],
          cents,
        ) &&
        list(
          s.premiumBreakdown,
          (p) =>
            record(p) &&
            ["NIGHT", "SUNDAY", "HOLIDAY", "SATURDAY", "OTHER"].includes(String(p.category)) &&
            fields(p, ["paidPremiumCents", "taxFreeCents", "taxablePremiumCents"], cents),
        ),
    )
  );
}
function forecast(v: unknown, request?: AnalysisSalaryRequest): boolean {
  if (!record(v) || !month(v.sourceMonth) || !record(v.result)) return false;
  if (v.result.status === "unavailable")
    return (
      ["sfn", "net-pay"].includes(String(v.result.stage)) &&
      text(v.result.reason) &&
      v.result.reason.length > 0 &&
      !v.result.reason.includes("konnte nicht berechnet werden")
    );
  return (
    v.result.status === "available" &&
    classification(v.result.classification) &&
    net(v.result.pay, request?.month) &&
    optional(v.basicHourlyPayCents, cents) &&
    optional(v.regularGrossCents, cents) &&
    optional(v.pensionOmitted, (b) => typeof b === "boolean") &&
    optional(
      v.annualPayment,
      (p) =>
        record(p) &&
        fields(p, ["grossCents", "totalGrossCents"], cents) &&
        typeof p.netIncluded === "boolean" &&
        typeof p.pensionOmitted === "boolean" &&
        text(p.note),
    )
  );
}
function annual(v: unknown): boolean {
  if (!record(v) || typeof v.automatic !== "boolean") return false;
  try {
    validateAnnualSalaryPayments(v.payments);
  } catch {
    return false;
  }
  if (v.proposal === null)
    return (
      record(v.issue) &&
      [
        "TARIFF_CHANGE",
        "SALARY_BASIS_CONFLICT",
        "UNSUPPORTED_YEAR",
        "UNSUPPORTED_GROUP",
        "NO_TARIFF",
        "TEST_DATA",
        "REFERENCE_MONTH_UNAVAILABLE",
      ].includes(String(v.issue.code)) &&
      (v.issue.code !== "REFERENCE_MONTH_UNAVAILABLE" || month(v.issue.month))
    );
  return (
    record(v.proposal) &&
    fields(v.proposal, ["grossCents", "basisCents", "rateBasisPoints"], cents) &&
    list(v.proposal.referenceMonths, month) &&
    text(v.proposal.note) &&
    (v.issue === null || v.issue === undefined)
  );
}

/** Validate the complete persisted salary, including the dated payout projection and deductions. */
export function persistentSalaryValue(
  value: unknown,
  request?: AnalysisSalaryRequest,
): value is PreparedAnalysisSalary {
  if (!record(value) || !serializable(value) || !annual(value.annual)) return false;
  if (request?.payment && !projection(value.projection, request)) return false;
  if (value.projection !== undefined && !projection(value.projection, request)) return false;
  const needsForecast =
    request?.settings?.version === 2 && request.payment?.perspective !== "EARNED";
  if (value.forecast === null) return !needsForecast;
  return forecast(value.forecast, request);
}
