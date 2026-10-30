import type { SpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement, type StandbyAgreement } from "@/domain/standby-agreement";
import type { DutyTariffFamily } from "@/engine/special-duty-tariff";
import { DutyChoice, DutyHint } from "./special-duty-controls";

/** Keep the required follow-up directly beside the user's settlement choice. */
export function StandbyTimeOffFields({
  value,
  tariffFamily,
  onChange,
}: {
  readonly value: SpecialDuty;
  readonly tariffFamily: DutyTariffFamily | null;
  readonly onChange: (next: SpecialDuty) => void;
}) {
  if (value.kind !== "STANDBY" || value.settlement !== "TIME_OFF") return null;
  const tariff = tariffFamily ?? value.standbyAgreement?.tariff;
  if (!tariff)
    return <DutyHint>Wähle unter Abrechnung zuerst den Tarifbereich deiner Bereitschaft.</DutyHint>;
  const agreement =
    value.standbyAgreement?.tariff === tariff
      ? value.standbyAgreement
      : newStandbyAgreement(tariff);
  return (
    <>
      <DutyChoice
        label="Berechnung der Zeitgutschrift"
        value={agreement.timeOffMode}
        options={[
          { value: "UNKNOWN", label: "Bitte wählen" },
          { value: "WEIGHTED", label: "Bewertete Dienstzeit" },
          ...(tariff === "TVOED_K" ? [{ value: "FACTORIZED", label: "Fester Minutenfaktor" }] : []),
        ]}
        onChange={(mode) =>
          onChange({
            ...value,
            version: value.version === 3 ? 3 : 2,
            standbyAgreement: {
              ...agreement,
              timeOffMode: mode as StandbyAgreement["timeOffMode"],
            },
          })
        }
      />
      <DutyHint>
        {agreement.timeOffMode === "UNKNOWN"
          ? "Wähle das Verfahren laut Vereinbarung. Bis dahin bleiben Gehalt und Zeitkonto offen."
          : agreement.timeOffMode === "FACTORIZED"
            ? "Die vereinbarten Minuten je Dienststunde bestimmen deine Zeitgutschrift."
            : "Bereitschaftsstufe und umwandelbare Zuschläge bestimmen deine Zeitgutschrift."}
      </DutyHint>
    </>
  );
}
