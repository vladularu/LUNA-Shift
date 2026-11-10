import { employmentProfileAt } from "@/domain/employment-history";
import { Temporal } from "@js-temporal/polyfill";
import {
  resolveRemunerationProfile,
  type RemunerationSelection,
} from "@/domain/remuneration-profile";
import { salaryBasisCount } from "@/domain/salary-basis-conflict";
import {
  TARIFF_TIME_POLICIES,
  TARIFF_TIME_REVIEW,
  type TariffTimeFamily,
  type TariffTimePolicy,
} from "@/domain/tariff-time-policy";
import type { UserProfile } from "@/domain/types";
import type { TargetTariff, WorkingTimeTargetProfile } from "@/domain/working-time-target";

export interface TariffTimeContext {
  readonly policy: TariffTimePolicy | null;
  readonly label: string;
  readonly training: boolean;
  readonly scopeConfirmed: boolean;
  readonly unavailable: boolean;
  readonly unavailableReason: "CONFLICT" | "COVERAGE" | "SCOPE" | null;
  readonly requirements: readonly string[];
  readonly sundayHolidayWorkEligible: boolean | null;
  /** LUNA working-model basis, not a separate legal confirmation. */
  readonly sundayWorkModelKnown?: boolean;
  readonly key: string;
}

type Candidate = { family: TariffTimeFamily; training?: boolean; missingEmployer?: boolean };

function fromTarget(tariff: TargetTariff): Candidate | "NONE" | null {
  switch (tariff.kind) {
    case "TVOED_K":
    case "TVOED_B":
    case "TVL_KR":
    case "TVH_KR":
      return { family: tariff.kind };
    case "TVUK_NURSING":
      return { family: "TVUK" };
    case "TVAOED_K":
      return { family: "TVOED_K", training: true };
    case "TVAOED_B":
      return { family: "TVOED_B", training: true };
    case "TVAL_KR":
      return { family: "TVL_KR", training: true };
    case "TVAL_GENERAL":
      return { family: "TVL_GENERAL", training: true };
    case "TVAL_COMMON":
      return { family: "TVL_GENERAL", training: true, missingEmployer: true };
    case "CUSTOM":
      return "NONE";
    case "UNVERIFIED":
      return null;
  }
}

function fromSelection(selection: RemunerationSelection): Candidate | "NONE" | null {
  if (selection.kind !== "tariff") return "NONE";
  if (selection.packageId === "tvoed-vka-bt-k" || selection.packageId === "tvoed-p-vka-legacy")
    return selection.variant === "BT_B"
      ? { family: "TVOED_B" }
      : selection.variant === "BT_K"
        ? { family: "TVOED_K" }
        : null;
  if (selection.packageId === "tvaoed-pflege-vka")
    return selection.variant === "BT_B"
      ? { family: "TVOED_B", training: true }
      : selection.variant === "BT_K"
        ? { family: "TVOED_K", training: true }
        : null;
  if (selection.packageId === "tvl-kr-tdl") return { family: "TVL_KR" };
  if (selection.packageId === "tval-pflege-tdl")
    return {
      family: selection.tvalEmployerScope === "SECTION_43" ? "TVL_KR" : "TVL_GENERAL",
      training: true,
      missingEmployer: selection.tvalEmployerScope == null,
    };
  return null;
}

function fromProfile(p: UserProfile): Candidate | "NONE" | null {
  if (p.tariff) return { family: p.tariff.sector === "BT_B" ? "TVOED_B" : "TVOED_K" };
  if (p.vkaETariff) return { family: p.vkaETariff.sector === "BT_B" ? "TVOED_B" : "TVOED_K" };
  if (p.tvlKrTariff) return { family: "TVL_KR" };
  if (p.tvhKrTariff) return { family: "TVH_KR" };
  if (p.tvUkNursingTariff) return { family: "TVUK" };
  if (p.nursingTrainingTariff)
    return {
      family: p.nursingTrainingTariff.sector === "BT_B" ? "TVOED_B" : "TVOED_K",
      training: true,
    };
  if (p.tvalPflegeTariff)
    return {
      family: p.tvalPflegeTariff.employerScope === "SECTION_43" ? "TVL_KR" : "TVL_GENERAL",
      training: true,
      missingEmployer: p.tvalPflegeTariff.employerScope == null,
    };
  return "NONE";
}

/** A tariff candidate is not confirmation of individual legal applicability. */
export function tariffContextAt(profile: UserProfile, date: string): TariffTimeContext | null {
  const p = employmentProfileAt(profile, date);
  const requirements: string[] = [];
  let candidate: Candidate | "NONE" | null;
  let scopeConfirmed = false;
  let scopeExcluded = false;
  let conflict = false;
  let boundaries: readonly (string | null)[] = ["1900-01-01", null, null, null];
  if (p.salaryBasisConflict || salaryBasisCount(p) > 1) {
    conflict = true;
    candidate = null;
    requirements.push("Wähle eine eindeutige Tarifgrundlage für diesen Zeitraum.");
  } else {
    const target = (profile as UserProfile & WorkingTimeTargetProfile).workingTimeTarget;
    if (target !== undefined) {
      candidate = null;
      if (target.status !== "ready") {
        requirements.push(
          target.status === "loading"
            ? "Die Arbeitszeit-Tarifgrundlage wird noch geladen."
            : "Die Arbeitszeit-Tarifgrundlage konnte nicht geladen werden. Bitte prüfe die Arbeitszeitdaten.",
        );
      } else if (!target.context) {
        requirements.push(
          "Für die bereitgestellten Arbeitszeitdaten ist kein Tarifzeitraum verfügbar.",
        );
      } else {
        const employment = target.context.employment;
        const matches = target.context.periods.filter(
          (period) =>
            period.validFrom <= date && (period.validTo === null || period.validTo >= date),
        );
        if (
          employment &&
          (date < employment.from || (employment.to !== null && date > employment.to))
        ) {
          requirements.push(
            "Die erfassten Dienste liegen außerhalb des hinterlegten Beschäftigungszeitraums.",
          );
        } else if (matches.length !== 1) {
          requirements.push(
            matches.length === 0
              ? "Die vorhandenen Arbeitszeit-Tarifzeiträume decken dieses Datum nicht ab."
              : "Mehrere Arbeitszeit-Tarifzeiträume gelten zugleich. Die Zuordnung ist zu klären.",
          );
        } else {
          const period = matches[0];
          candidate = fromTarget(period.tariff);
          if (
            period.tariff.kind === "UNVERIFIED" &&
            ["OWN_OR_UNCONFIGURED", "CURRENT_SALARY_SELECTION"].includes(period.tariff.id)
          )
            candidate = fromProfile(p);
          scopeConfirmed =
            target.mode !== "FORECAST" &&
            "scopeConfirmed" in period.tariff &&
            period.tariff.scopeConfirmed === true;
          scopeExcluded =
            "scopeConfirmed" in period.tariff && period.tariff.scopeConfirmed === false;
          boundaries = [
            period.validFrom,
            period.validTo,
            employment?.from ?? null,
            employment?.to ?? null,
          ];
        }
      }
    } else {
      const dated = profile.employmentTimeline?.length
        ? resolveRemunerationProfile(profile.employmentTimeline, date).profile
        : null;
      candidate = dated && !dated.employment ? fromSelection(dated.data.selection) : fromProfile(p);
      if (dated) {
        const next = profile.employmentTimeline
          ?.flatMap((item) =>
            item.effectiveFrom !== null && item.effectiveFrom > date ? [item.effectiveFrom] : [],
          )
          .sort()[0];
        boundaries = [
          dated.effectiveFrom ?? "1900-01-01",
          next ? Temporal.PlainDate.from(next).subtract({ days: 1 }).toString() : null,
          null,
          null,
        ];
      }
    }
    if (candidate === null)
      requirements.push("Die Tarifzuordnung ist für diesen Zeitraum nicht hinreichend bestimmt.");
  }
  if (candidate === "NONE") return null;
  const trainingFamily: Partial<Record<TariffTimeFamily, TariffTimeFamily>> = {
    TVOED_K: "TVAOED_K",
    TVOED_B: "TVAOED_B",
    TVL_KR: "TVAL_KR",
    TVL_GENERAL: "TVAL_GENERAL",
  };
  const family = candidate?.training
    ? (trainingFamily[candidate.family] ?? candidate.family)
    : candidate?.family;
  const policy = family ? TARIFF_TIME_POLICIES[family] : null;
  const reviewed = date >= TARIFF_TIME_REVIEW.from && date <= TARIFF_TIME_REVIEW.until;
  if (!reviewed)
    requirements.push(
      "Die Tarifregeln sind für diesen Zeitraum noch nicht in dieser Prüffassung geprüft.",
    );
  if (candidate?.missingEmployer)
    requirements.push("Der Beschäftigtentarif des Ausbildenden ist noch zu bestätigen.");
  if (scopeExcluded)
    requirements.push(
      "Der Geltungsbereich wurde in den Arbeitszeitdaten ausgeschlossen; die Tarifzuordnung ist zu klären.",
    );
  if (candidate?.training)
    requirements.push(
      "Alter, Schulzeiten und der Beschäftigtentarif des Ausbildenden sind für die Ausbildungsprüfung zu bestätigen.",
    );
  if (policy?.family === "TVH_KR")
    requirements.push(
      "Die Zuordnung zum Krankenpflegedienst im Justizvollzug und der abschließende ÄTV-25-Abgleich bleiben zu prüfen.",
    );
  const training = candidate?.training === true;
  const label = policy?.label ?? "Tarifvertrag";
  const unavailable =
    !candidate || !reviewed || candidate.missingEmployer === true || scopeExcluded;
  const unavailableReason = conflict
    ? "CONFLICT"
    : !reviewed
      ? "COVERAGE"
      : unavailable
        ? "SCOPE"
        : null;
  return {
    policy,
    label,
    training,
    scopeConfirmed,
    unavailable,
    unavailableReason,
    requirements,
    sundayHolidayWorkEligible: p.sundayHolidayWorkEligible,
    sundayWorkModelKnown:
      p.sundayHolidayWorkEligible === true ||
      (p.sundayHolidayWorkEligible !== false &&
        p.workPattern?.workplaceCoverage === "AROUND_THE_CLOCK" &&
        p.workPattern.assignment === "PERMANENT"),
    key: JSON.stringify([
      policy?.family ?? null,
      training,
      scopeConfirmed,
      unavailable,
      requirements,
      p.sundayHolidayWorkEligible,
      p.workPattern ?? null,
      boundaries,
    ]),
  };
}
