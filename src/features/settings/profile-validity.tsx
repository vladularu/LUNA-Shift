import { useRef, useState } from "react";
import { Keyboard, View, Pressable } from "react-native";
import { Temporal } from "@js-temporal/polyfill";
import type { SaveProfileInput, UserProfile } from "@/domain/types";
import {
  captureEmploymentProfile,
  employmentTimelineKey,
  employmentProfileAt,
} from "@/domain/employment-history";
import { requireRemunerationDate } from "@/domain/remuneration-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { SelectionSheet } from "@/ui/selection-sheet";
import { SelectionRow } from "@/ui/selection-option";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard, RowButton } from "@/ui/design-system";
import { profileWorkLabel, profileSalaryLabel } from "./work-profile-summary";
import { ProfileDateField } from "./profile-date-field";
import {
  employmentChangedFields,
  employmentChangeLines,
  employmentUndoInput,
} from "./employment-change";

type BuildInput = (date: string, final: boolean) => SaveProfileInput;
export function useEmploymentSaveFlow(initial: UserProfile) {
  const { updateProfile } = usePflegeShiftProfile();
  const [base, setBase] = useState(initial);
  const [current, setCurrent] = useState(initial);
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{ build: BuildInput; lines: readonly string[] } | null>(
    null,
  );
  const [scope, setScope] = useState<"all" | "date" | null>(null);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ before: UserProfile; saved: UserProfile } | null>(null);
  const today = Temporal.Now.plainDateISO(base.timeZone).toString();
  async function commit(build: BuildInput, selected: "all" | "date", day: string) {
    if (busy.current) return;
    try {
      const effectiveFrom =
        selected === "all"
          ? null
          : requireRemunerationDate(
              /^\d{2}\.\d{2}\.\d{4}$/u.test(day) ? day.split(".").reverse().join("-") : day,
            );
      const input = build(effectiveFrom ?? today, true);
      const fields = employmentChangedFields(base, input);
      if (!fields.length) {
        setPending(null);
        setMessage("Keine Änderungen zu speichern.");
        return;
      }
      busy.current = true;
      setSaving(true);
      setError(null);
      const saved = await updateProfile({
        ...input,
        validity: {
          effectiveFrom,
          fields,
          expectedProfileUpdatedAt: base.updatedAt,
          expectedTimeline: employmentTimelineKey(base.employmentTimeline ?? []),
          baseline: captureEmploymentProfile(base),
          ...(effectiveFrom === null ? { correctionFields: fields } : {}),
        },
      });
      const changed =
        employmentTimelineKey(saved.employmentTimeline ?? []) !==
          employmentTimelineKey(current.employmentTimeline ?? []) ||
        employmentChangedFields(current, saved).length > 0;
      if (changed) setReceipt({ before: current, saved });
      setCurrent(saved);
      setBase(saved);
      setEditingFrom(null);
      setRevision((v) => v + 1);
      setPending(null);
      setMessage(
        !changed
          ? "Diese Angaben sind für den Zeitraum bereits gespeichert."
          : effectiveFrom
            ? `Gespeichert · ab ${effectiveFrom.split("-").reverse().join(".")}`
            : "Gespeichert · bisherige Angaben berichtigt",
      );
    } catch (e) {
      setError(userFacingErrorMessage(e, "Die Angaben konnten nicht gespeichert werden."));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  function request(build: BuildInput) {
    if (busy.current) return;
    try {
      Keyboard.dismiss();
      setError(null);
      const input = build(today, false),
        lines = employmentChangeLines(base, input);
      if (!lines.length) {
        setMessage("Keine Änderungen zu speichern.");
        return;
      }
      if (
        !base.salaryBasisConflict &&
        base.regularRotatingNightWork == null &&
        base.sundayHolidayWorkEligible == null &&
        base.allEmploymentWorkRecorded == null &&
        (!base.workPattern ||
          (base.workPattern.workplaceCoverage === "UNKNOWN" &&
            base.workPattern.assignment === "UNKNOWN")) &&
        !base.employmentTimeline?.length &&
        ![
          base.tariff,
          base.manualMonthlyGrossCents,
          base.nursingTrainingTariff,
          base.vkaETariff,
          base.tvlKrTariff,
          base.tvhKrTariff,
          base.tvUkNursingTariff,
          base.tvalPflegeTariff,
        ].some(Boolean)
      ) {
        void commit(build, "all", "");
        return;
      }
      setScope(editingFrom ? "date" : null);
      setDate(editingFrom ? editingFrom.split("-").reverse().join(".") : "");
      setPending({ build, lines });
    } catch (e) {
      setError(userFacingErrorMessage(e, "Bitte deine Angaben prüfen."));
    }
  }
  async function undo() {
    if (!receipt || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const restored = await updateProfile(employmentUndoInput(receipt.before, receipt.saved));
      setCurrent(restored);
      setBase(restored);
      setEditingFrom(null);
      setRevision((v) => v + 1);
      setReceipt(null);
      setMessage("Letzte Änderung zurückgenommen.");
    } catch (e) {
      setError(userFacingErrorMessage(e, "Die Änderung konnte nicht zurückgenommen werden."));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  function editPeriod(from: string) {
    if (busy.current || pending) return;
    const item = current.employmentTimeline?.find(
      (item) => item.effectiveFrom === from && item.employment,
    );
    if (!item) return;
    setBase(employmentProfileAt(current, from));
    setEditingFrom(from);
    setRevision((v) => v + 1);
    setMessage(null);
    setError(null);
  }
  return {
    base,
    current,
    editingFrom,
    editPeriod,
    revision,
    referenceDate: today,
    pending,
    scope,
    setScope,
    date,
    setDate,
    saving,
    message,
    error,
    receipt,
    request,
    undo,
    confirm: () => (pending ? commit(pending.build, scope!, date) : Promise.resolve()),
    close: () => {
      if (!busy.current) {
        setPending(null);
        setError(null);
      }
    },
    discard: () => {
      if (!busy.current) {
        setRevision((v) => v + 1);
        setMessage(null);
        setError(null);
      }
    },
    endHistory: () => {
      if (!busy.current) {
        setBase(current);
        setEditingFrom(null);
        setRevision((v) => v + 1);
        setMessage(null);
        setError(null);
      }
    },
  };
}
export type EmploymentSaveFlow = ReturnType<typeof useEmploymentSaveFlow>;
export function EmploymentSaveDialog({ flow }: { readonly flow: EmploymentSaveFlow }) {
  const palette = usePalette();
  if (!flow.pending) return null;
  return (
    <SelectionSheet
      title="Seit wann gelten diese Angaben?"
      visible={flow.pending !== null}
      onClose={flow.close}
      disabled={flow.saving}
      cancelLabel="Zurück zu deinen Angaben"
      footer={
        <PrimaryButton
          busy={flow.saving}
          disabled={flow.saving || !flow.scope || (flow.scope === "date" && !flow.date.trim())}
          onPress={() => void flow.confirm()}
        >
          {flow.scope === "all"
            ? "Gesamten Zeitraum berichtigen"
            : flow.scope === "date" && flow.date.trim()
              ? `Ab ${flow.date} speichern`
              : "Speichern"}
        </PrimaryButton>
      }
    >
      {() => (
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          {flow.pending?.lines.map((line) => (
            <Text key={line} style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
              {line}
            </Text>
          ))}
          <View accessibilityRole="radiogroup" accessibilityLabel="Zeitraum der Änderung">
            <SelectionRow
              label="Ab einem Datum"
              selected={flow.scope === "date"}
              disabled={flow.saving}
              onPress={() => flow.setScope("date")}
            />
            {flow.scope === "date" ? (
              <>
                <ProfileDateField
                  value={flow.date}
                  onChange={flow.setDate}
                  disabled={flow.saving}
                />
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                  Frühere Berechnungen bleiben unverändert.
                </Text>
              </>
            ) : null}
            <SelectionRow
              label="Für den gesamten Zeitraum"
              selected={flow.scope === "all"}
              disabled={flow.saving}
              onPress={() => flow.setScope("all")}
            />
            {flow.scope === "all" ? (
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                Diese Angaben galten schon vorher. Frühere Berechnungen werden berichtigt.
              </Text>
            ) : null}
          </View>
          {flow.scope === "all"
            ? (flow.base.employmentTimeline ?? [])
                .filter((p) => p.effectiveFrom && p.effectiveFrom > flow.referenceDate)
                .map((p) => (
                  <Text
                    key={p.effectiveFrom}
                    style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
                  >
                    Geplante Änderung ab {p.effectiveFrom!.split("-").reverse().join(".")} bleibt
                    erhalten.
                  </Text>
                ))
            : null}
          <FormStatus error={flow.error} />
        </View>
      )}
    </SelectionSheet>
  );
}
export function EmploymentSaveFeedback({
  flow,
  dirty = false,
}: {
  readonly flow: EmploymentSaveFlow;
  readonly dirty?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const palette = usePalette();
  const history = (flow.current.employmentTimeline ?? []).filter(
    (p) => p.effectiveFrom && p.employment,
  );
  return (
    <>
      <FormStatus message={flow.message} error={flow.pending ? null : flow.error} />
      {flow.receipt ? (
        <SecondaryButton disabled={flow.saving} onPress={() => void flow.undo()}>
          Letzte Änderung rückgängig
        </SecondaryButton>
      ) : null}
      {flow.editingFrom ? (
        <SecondaryButton disabled={flow.saving} onPress={flow.endHistory}>
          Zurück zu aktuellen Angaben
        </SecondaryButton>
      ) : null}
      {history.length ? (
        <View style={{ gap: SPACING.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Änderungsverlauf"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((v) => !v)}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
              Änderungsverlauf {expanded ? "⌃" : "⌄"}
            </Text>
          </Pressable>
          {expanded ? (
            <SurfaceCard>
              {history.map((item) => {
                const selected = employmentProfileAt(flow.current, item.effectiveFrom!);
                return (
                  <RowButton
                    key={item.effectiveFrom}
                    title={`Ab ${item.effectiveFrom!.split("-").reverse().join(".")}`}
                    subtitle={`${profileWorkLabel(selected)} · ${profileSalaryLabel(selected)}`}
                    accessibilityLabel={`Angaben ab ${item.effectiveFrom!.split("-").reverse().join(".")} berichtigen`}
                    disabled={flow.saving || dirty}
                    onPress={() => flow.editPeriod(item.effectiveFrom!)}
                  />
                );
              })}
            </SurfaceCard>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
