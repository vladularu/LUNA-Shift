import { Temporal } from "@js-temporal/polyfill";
import type { UserProfile } from "@/domain/types";
import type { TvalPflegeTariff } from "@/domain/tval-pflege-tariff";
import { resolveRemunerationProfile } from "@/domain/remuneration-profile";

export const TVAL_WORKPLACE_OPTIONS = [
  { value: "SECTION_43", label: "Krankenhaus / ärztliche Behandlung" },
  { value: "GENERAL", label: "Anderer Arbeitsbereich" },
  { value: "UNKNOWN", label: "Noch nicht geklärt" },
] as const;
export type TvalWorkplaceChoice = (typeof TVAL_WORKPLACE_OPTIONS)[number]["value"];

/** Reuse explicit applicable metadata; neither profession nor Sunday work proves hospital scope. */
export function tvalWorkplaceChoice(
  profile: UserProfile,
  date = Temporal.Now.plainDateISO(profile.timeZone).toString(),
): TvalWorkplaceChoice {
  const selected = profile.tvalPflegeTariff;
  if (!selected) return "UNKNOWN";
  if (Object.hasOwn(selected, "employerScope")) return selected.employerScope ?? "UNKNOWN";
  const financial = resolveRemunerationProfile(profile.employmentTimeline ?? [], date).profile?.data
    .selection;
  return financial?.kind === "tariff" &&
    financial.packageId === "tval-pflege-tdl" &&
    financial.variant === "CARE" &&
    financial.group === "regular" &&
    ["1", "2", "3"].includes(financial.level) &&
    ["WEST_38_5", "EAST", "EAST_UNIVERSITY_HOSPITAL"].includes(financial.region)
    ? (financial.tvalEmployerScope ?? "UNKNOWN")
    : "UNKNOWN";
}
export function tvalWorkplaceFields(
  choice: TvalWorkplaceChoice,
  previous?: TvalPflegeTariff | null,
  changed = false,
): Pick<TvalPflegeTariff, "employerScope"> {
  if (choice !== "UNKNOWN") return { employerScope: choice };
  return changed || (previous && Object.hasOwn(previous, "employerScope"))
    ? { employerScope: null }
    : {};
}
export function tvalWorkplaceLabel(choice: TvalWorkplaceChoice): string {
  return TVAL_WORKPLACE_OPTIONS.find((option) => option.value === choice)!.label;
}
