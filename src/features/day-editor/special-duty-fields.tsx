import { StandbyAgreementFields } from "./standby-agreement-fields";
import { Fragment, useRef, useState } from "react";
import { View } from "react-native";
import {
  clockMinute,
  dutyClock,
  DUTY_LABELS,
  newSpecialDuty,
  type DutyCallout,
  type SpecialDuty,
} from "@/domain/special-duty";
import { standbyLevels, type DutyTariffFamily } from "@/engine/special-duty-tariff";
import { SPACING } from "@/theme/tokens";
import { EntryEditGroup } from "./entry-edit-fields";
import {
  DutyAction,
  DutyChoice,
  DutyDivider,
  DutyHeading,
  DutyHint,
  DutyMinutesField,
  DutyValueRow,
} from "./special-duty-controls";
import {
  changeDutyClock,
  dutyDurationLabel,
  dutyFormFeedback,
  dutyIntervalMinutes,
  dutyParentPart,
} from "./special-duty-form-state";
import { DutyTimeBlock } from "./special-duty-time-block";

type DutyKind = SpecialDuty["kind"] | "REGULAR";
interface DutyDraft {
  readonly duty: SpecialDuty | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: string;
}

export function SpecialDutyFields({
  value,
  onChange,
  startTime,
  endTime,
  breakMinutes,
  onStartChange,
  onEndChange,
  onBreakMinutesChange,
  timeZone,
  date,
  template = false,
  tariffFamily = null,
}: {
  readonly value: SpecialDuty | null;
  readonly onChange: (duty: SpecialDuty | null) => void;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: string;
  readonly onStartChange: (value: string) => void;
  readonly onEndChange: (value: string) => void;
  readonly onBreakMinutesChange: (value: string) => void;
  readonly timeZone: string;
  readonly date?: string;
  readonly template?: boolean;
  readonly tariffFamily?: DutyTariffFamily | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Session-only drafts: changing the form must not discard parts or actual calls.
  const drafts = useRef<Partial<Record<DutyKind, DutyDraft>>>({});
  const parent = dutyParentPart(startTime, endTime, value?.endDay ?? 0, breakMinutes);
  const feedback = value ? dutyFormFeedback(value, parent, date) : null;

  function rememberDraft() {
    drafts.current[value?.kind ?? "REGULAR"] = { duty: value, startTime, endTime, breakMinutes };
  }

  function choose(kind: string) {
    if (kind === (value?.kind ?? "REGULAR")) return;
    rememberDraft();
    const nextKind = kind as DutyKind;
    const saved = drafts.current[nextKind];
    const next =
      saved?.duty ??
      (nextKind === "REGULAR" ? null : newSpecialDuty(nextKind, startTime, endTime, timeZone));
    onChange(next);
    onStartChange(saved?.startTime ?? startTime);
    onEndChange(saved?.endTime ?? endTime);
    onBreakMinutesChange(saved?.breakMinutes ?? (nextKind === "ON_CALL" ? "0" : breakMinutes));
  }

  function addPart() {
    if (!value) rememberDraft();
    const duty =
      value?.kind === "SPLIT" ? value : newSpecialDuty("SPLIT", startTime, endTime, timeZone);
    const start =
      Math.max(duty.endDay * 1440 + clockMinute(endTime), ...duty.parts.map((part) => part.end)) +
      60;
    onChange({ ...duty, parts: [...duty.parts, { start, end: start + 240, breakMinutes: 0 }] });
  }

  function changeParentClock(field: "start" | "end", time: string) {
    if (!value) return;
    (field === "start" ? onStartChange : onEndChange)(time);
    try {
      const next = changeDutyClock(parent, field, time);
      if (Number.isFinite(next.end)) {
        onEndChange(dutyClock(next.end));
        onChange({
          ...value,
          endDay: Math.floor(next.end / 1440),
          ...(value.kind === "ON_CALL" ? { calloutsComplete: false } : {}),
        });
      }
    } catch {
      /* A partially entered web time is validated beside the block. */
    }
  }

  function updateCallout(index: number, next: DutyCallout) {
    if (!value) return;
    onChange({
      ...value,
      calloutsComplete: false,
      callouts: value.callouts.map((call, i) => (i === index ? next : call)),
    });
  }

  const parentTitle =
    value?.kind === "SPLIT"
      ? "Dienstteil 1"
      : value?.kind === "ON_CALL"
        ? "Rufbereitschaftszeitraum"
        : "Bereitschaftszeitraum";
  return (
    <View testID="special-duty-fields" style={{ gap: SPACING.md }}>
      <EntryEditGroup>
        <DutyChoice
          label="Dienstform"
          value={value?.kind ?? "REGULAR"}
          options={[
            { value: "REGULAR", label: "Regulärer Dienst" },
            ...Object.entries(DUTY_LABELS).map(([key, label]) => ({ value: key, label })),
          ]}
          onChange={choose}
        />
        {!value ? <DutyAction label="Dienstteil hinzufügen" onPress={addPart} /> : null}
      </EntryEditGroup>
      {value ? (
        <>
          <EntryEditGroup>
            {value.kind === "ON_CALL" ? (
              <DutyHint>
                {template
                  ? "Du bist erreichbar. Tatsächliche Einsätze erfasst du später im eingetragenen Dienst."
                  : "Du bist erreichbar. Erfasse deine tatsächlichen Einsätze darunter."}
              </DutyHint>
            ) : value.kind === "STANDBY" ? (
              <DutyHint>
                Du bist vor Ort und arbeitest bei Bedarf. Nur echte Pausen ohne Bereitschaftspflicht
                werden von Dienstzeit und Vergütung abgezogen.
              </DutyHint>
            ) : null}
            <DutyTimeBlock
              title={parentTitle}
              value={parent}
              fixedStartDay
              hidePause={value.kind === "ON_CALL"}
              maxDay={value.kind === "ON_CALL" ? 14 : 1}
              error={feedback?.parentError}
              parentFields={{
                startTime,
                endTime,
                breakMinutes,
                onStartChange: (time) => changeParentClock("start", time),
                onEndChange: (time) => changeParentClock("end", time),
                onPauseChange: onBreakMinutesChange,
              }}
              onChange={(part) =>
                onChange({
                  ...value,
                  endDay: Math.floor(part.end / 1440),
                  ...(value.kind === "ON_CALL" ? { calloutsComplete: false } : {}),
                })
              }
            />
            {value.kind === "SPLIT" ? (
              <>
                {value.parts.map((part, index) => {
                  const previous = index === 0 ? parent : value.parts[index - 1];
                  const gap =
                    feedback?.workMinutes !== null && part.start > previous.end
                      ? dutyIntervalMinutes(previous.end, part.start, value.timeZone, date)
                      : null;
                  return (
                    <Fragment key={index}>
                      <DutyDivider />
                      {gap !== null ? (
                        <DutyHint>{dutyDurationLabel(gap)} Unterbrechung</DutyHint>
                      ) : null}
                      <DutyTimeBlock
                        title={`Dienstteil ${index + 2}`}
                        value={part}
                        error={feedback?.partErrors[index]}
                        onChange={(next) =>
                          onChange({
                            ...value,
                            parts: value.parts.map((item, i) => (i === index ? next : item)),
                          })
                        }
                        onRemove={() =>
                          onChange({ ...value, parts: value.parts.filter((_, i) => i !== index) })
                        }
                      />
                    </Fragment>
                  );
                })}
                <DutyDivider />
                {value.parts.length < 8 ? (
                  <DutyAction label="Dienstteil hinzufügen" onPress={addPart} />
                ) : null}
                {feedback?.workMinutes !== null && feedback?.workMinutes !== undefined ? (
                  <DutyValueRow
                    label={template ? "Geplante Arbeitszeit" : "Erfasste Arbeitszeit"}
                    value={dutyDurationLabel(feedback.workMinutes)}
                  />
                ) : null}
              </>
            ) : null}
          </EntryEditGroup>

          {value.kind === "ON_CALL" && !template ? (
            <EntryEditGroup>
              <DutyHeading>Einsätze</DutyHeading>
              {!value.callouts.length ? <DutyHint>Noch keine Einsätze erfasst.</DutyHint> : null}
              {value.callouts.map((call, index) => (
                <Fragment key={index}>
                  <DutyChoice
                    label="Einsatzart"
                    accessibilityLabel={`Einsatz ${index + 1}: Einsatzart`}
                    value={call.kind}
                    options={[
                      { value: "REMOTE", label: "Telefonisch / von zu Hause" },
                      { value: "ON_SITE", label: "Vor Ort" },
                    ]}
                    onChange={(kind) =>
                      updateCallout(index, {
                        ...call,
                        kind: kind as DutyCallout["kind"],
                        departure: call.start,
                        returned: call.end,
                      })
                    }
                  />
                  <DutyTimeBlock
                    title={`Einsatz ${index + 1}`}
                    value={call}
                    maxDay={value.endDay}
                    error={feedback?.calloutErrors[index]}
                    onChange={(next) =>
                      updateCallout(index, {
                        ...call,
                        ...next,
                        departure: next.start - (call.start - call.departure),
                        returned: next.end + (call.returned - call.end),
                      })
                    }
                  />
                  {call.kind === "ON_SITE" ? (
                    <>
                      <DutyMinutesField
                        label="Hinweg"
                        accessibilityLabel={`Einsatz ${index + 1}: Hinweg in Minuten`}
                        value={String(call.start - call.departure)}
                        onChange={(text) =>
                          updateCallout(index, { ...call, departure: call.start - Number(text) })
                        }
                      />
                      <DutyMinutesField
                        label="Rückweg"
                        accessibilityLabel={`Einsatz ${index + 1}: Rückweg in Minuten`}
                        value={String(call.returned - call.end)}
                        onChange={(text) =>
                          updateCallout(index, { ...call, returned: call.end + Number(text) })
                        }
                      />
                      <DutyHint>Wege unmittelbar vor und nach diesem Einsatz.</DutyHint>
                    </>
                  ) : null}
                  <DutyAction
                    destructive
                    label={`Einsatz ${index + 1} entfernen`}
                    onPress={() =>
                      onChange({
                        ...value,
                        callouts: value.callouts.filter((_, i) => i !== index),
                        calloutsComplete: false,
                      })
                    }
                  />
                  <DutyDivider />
                </Fragment>
              ))}
              {value.callouts.length < 64 ? (
                <DutyAction
                  label="Einsatz hinzufügen"
                  onPress={() => {
                    const start = value.callouts.at(-1)?.returned ?? clockMinute(startTime);
                    onChange({
                      ...value,
                      calloutsComplete: false,
                      callouts: [
                        ...value.callouts,
                        {
                          kind: "REMOTE",
                          start,
                          end: start + 15,
                          departure: start,
                          returned: start + 15,
                          breakMinutes: 0,
                        },
                      ],
                    });
                  }}
                />
              ) : null}
              <DutyChoice
                label="Erfassung"
                value={value.calloutsComplete ? "COMPLETE" : "OPEN"}
                options={[
                  { value: "OPEN", label: "Noch offen" },
                  {
                    value: "COMPLETE",
                    label: value.callouts.length ? "Alle Einsätze erfasst" : "Kein Einsatz",
                  },
                ]}
                onChange={(status) =>
                  onChange({ ...value, calloutsComplete: status === "COMPLETE" })
                }
              />
            </EntryEditGroup>
          ) : null}

          {value.kind === "STANDBY" ? (
            <EntryEditGroup>
              <DutyHeading>Vereinbarung</DutyHeading>
              <DutyChoice
                label="Bereitschaftsstufe"
                value={value.standbyLevel}
                options={[
                  { value: "UNKNOWN", label: "Weiß ich noch nicht" },
                  ...standbyLevels(tariffFamily ?? value.standbyAgreement?.tariff ?? null).map(
                    (level) => ({
                      value: level,
                      label: `Stufe ${level}`,
                    }),
                  ),
                ]}
                onChange={(level) =>
                  onChange({ ...value, standbyLevel: level as SpecialDuty["standbyLevel"] })
                }
              />
              <DutyHint>Laut deiner Vereinbarung.</DutyHint>
              <DutyDivider />
              <DutyChoice
                label="Ausgleich"
                value={value.settlement}
                options={[
                  { value: "UNKNOWN", label: "Weiß ich noch nicht" },
                  { value: "PAY", label: "Auszahlung" },
                  { value: "TIME_OFF", label: "Freizeitausgleich" },
                ]}
                onChange={(settlement) =>
                  onChange({ ...value, settlement: settlement as SpecialDuty["settlement"] })
                }
              />
            </EntryEditGroup>
          ) : null}

          {value.kind === "STANDBY" ? (
            <EntryEditGroup>
              <StandbyAgreementFields
                value={value}
                tariffFamily={tariffFamily}
                template={template}
                onChange={onChange}
              />
            </EntryEditGroup>
          ) : null}

          <EntryEditGroup>
            <DutyValueRow
              label="Hinweise zur Arbeitszeit"
              value=""
              accessibilityLabel="Hinweise zur Arbeitszeit"
              expanded={detailsOpen}
              onPress={() => setDetailsOpen(!detailsOpen)}
            />
            {detailsOpen ? (
              <DutyHint>
                {value.kind === "ON_CALL"
                  ? "Nur tatsächliche Einsätze und Wege zählen hier zur erfassten Arbeitszeit. Bei stark eingeschränkter Freizeit kann die rechtliche Einordnung abweichen."
                  : value.kind === "STANDBY"
                    ? "Auch Ruhephasen mit Bereitschaftspflicht zählen zur Arbeitsschutzzeit. Zeitgutschrift und Vergütung sind davon getrennt. Die gewählte Stufe allein bedeutet noch keine vollständige Abrechnung."
                    : "Die Dienstteile gehören zusammen. Die Unterbrechung zählt nicht zur Arbeitszeit. Pausen innerhalb jedes Teils erfasst du getrennt."}
              </DutyHint>
            ) : null}
            {value.kind !== "SPLIT" ? (
              <DutyHint>
                Die Abrechnung findest du unter Gehalt. Offene Angaben und Berechnungen bleiben dort
                sichtbar.
              </DutyHint>
            ) : null}
          </EntryEditGroup>
        </>
      ) : null}
    </View>
  );
}
