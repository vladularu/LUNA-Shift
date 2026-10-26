import type {
  SaveProfileInput,
  UserProfile,
  TvoedAssignment,
  TvoedWorkplaceCoverage,
} from "@/domain/types";
import { CardSeparator, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { ProfileChoice } from "./profile-selection";

export function employmentModelDraft(profile: UserProfile) {
  return {
    night: profile.regularRotatingNightWork ?? null,
    sunday: profile.sundayHolidayWorkEligible ?? null,
    recorded: profile.allEmploymentWorkRecorded ?? null,
    coverage: profile.workPattern?.workplaceCoverage ?? "UNKNOWN",
    assignment: profile.workPattern?.assignment ?? "UNKNOWN",
  };
}
export type EmploymentModelDraft = ReturnType<typeof employmentModelDraft>;
export function employmentModelInput(
  profile: UserProfile,
  model: EmploymentModelDraft,
): Partial<SaveProfileInput> {
  const before = employmentModelDraft(profile);
  return {
    regularRotatingNightWork: model.night,
    sundayHolidayWorkEligible: model.sunday,
    allEmploymentWorkRecorded: model.recorded,
    workPattern:
      model.coverage === before.coverage && model.assignment === before.assignment
        ? (profile.workPattern ?? null)
        : { workplaceCoverage: model.coverage, assignment: model.assignment },
  };
}
const evidence = (value: boolean | null) => (value === null ? "UNKNOWN" : value ? "YES" : "NO");
const bool = (value: string) => (value === "UNKNOWN" ? null : value === "YES");
const answers = [
  { value: "YES", label: "Ja" },
  { value: "NO", label: "Nein" },
  { value: "UNKNOWN", label: "Weiß ich nicht" },
];
export function EmploymentModelFields({
  value,
  onChange,
}: {
  readonly value: EmploymentModelDraft;
  readonly onChange: (next: EmploymentModelDraft) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Arbeitsmodell"
        caption="Grundlage für Sollzeit, Schichtzulagen und Arbeitszeitprüfung."
      />
      <SurfaceCard>
        <ProfileChoice
          label="Sonn- und Feiertagsarbeit"
          modalTitle="Ist Sonn- und Feiertagsarbeit für deine Tätigkeit erlaubt?"
          value={evidence(value.sunday)}
          options={answers}
          onChange={(next) => onChange({ ...value, sunday: bool(next) })}
        />
        <CardSeparator />
        <ProfileChoice
          label="Regelmäßige Nacht- oder Wechselschicht"
          value={evidence(value.night)}
          options={answers}
          onChange={(next) => onChange({ ...value, night: bool(next) })}
        />
        <CardSeparator />
        <ProfileChoice
          label="Arbeitsbereich rund um die Uhr"
          value={value.coverage}
          options={[
            { value: "AROUND_THE_CLOCK", label: "Ja, durchgehend 24/7" },
            { value: "NOT_AROUND_THE_CLOCK", label: "Nein" },
            { value: "UNKNOWN", label: "Weiß ich nicht" },
          ]}
          onChange={(next) => onChange({ ...value, coverage: next as TvoedWorkplaceCoverage })}
        />
        <CardSeparator />
        <ProfileChoice
          label="Zuordnung zum Schichtmodell"
          value={value.assignment}
          options={[
            { value: "PERMANENT", label: "Dauerhaft" },
            { value: "TEMPORARY", label: "Gelegentlich" },
            { value: "UNKNOWN", label: "Weiß ich nicht" },
          ]}
          onChange={(next) => onChange({ ...value, assignment: next as TvoedAssignment })}
        />
        <CardSeparator />
        <ProfileChoice
          label="Alle Arbeitszeiten einschließlich Nebenjob erfasst"
          value={evidence(value.recorded)}
          options={answers}
          onChange={(next) => onChange({ ...value, recorded: bool(next) })}
        />
      </SurfaceCard>
    </>
  );
}
