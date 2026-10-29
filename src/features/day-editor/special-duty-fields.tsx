import { standbyLevels, type DutyTariffFamily } from "@/engine/special-duty-tariff";
import { useState } from "react";
import { ActionSheetIOS, Platform, Pressable, View } from "react-native";
import {
  clockMinute,
  dutyClock,
  DUTY_LABELS,
  newSpecialDuty,
  type DutyPart,
  type SpecialDuty,
} from "@/domain/special-duty";
import { EntryEditGroup, EntryEditTimePair, EntryEditValueRow } from "./entry-edit-fields";
import { Field as InputField } from "@/ui/form-controls";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  return (
    <>
      <EntryEditValueRow
        label={label}
        value={options.find((option) => option.value === value)?.label ?? value}
        onPress={() => {
          if (Platform.OS !== "ios") {
            setOpen(!open);
            return;
          }
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: label,
              options: [...options.map((option) => option.label), "Abbrechen"],
              cancelButtonIndex: options.length,
              userInterfaceStyle: palette.dark ? "dark" : "light",
            },
            (index) => {
              if (options[index]) onChange(options[index].value);
            },
          );
        }}
      />
      {open
        ? options.map((option) => (
            <EntryEditValueRow
              key={option.value}
              label={option.label}
              value={option.value === value ? "Ausgewählt" : ""}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))
        : null}
    </>
  );
}

function Action({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", padding: 12 }}
    >
      <Text style={[TYPOGRAPHY.body, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function PartFields({
  value,
  onChange,
  label,
  onRemove,
  maxDay = 14,
}: {
  readonly value: DutyPart;
  readonly onChange: (part: DutyPart) => void;
  readonly label: string;
  readonly onRemove: () => void;
  readonly maxDay?: number;
}) {
  return (
    <View>
      <Choice
        label={`${label} – Tag`}
        value={String(Math.floor(value.start / 1440))}
        options={Array.from({ length: maxDay + 1 }, (_, day) => ({
          value: String(day),
          label: day === 0 ? "Am Dienstbeginn" : `${day} Tag${day === 1 ? "" : "e"} später`,
        }))}
        onChange={(day) => {
          const change = (Number(day) - Math.floor(value.start / 1440)) * 1440;
          onChange({ ...value, start: value.start + change, end: value.end + change });
        }}
      />
      <EntryEditTimePair
        startTime={dutyClock(value.start)}
        endTime={dutyClock(value.end)}
        onStartChange={(time) => {
          const start = Math.floor(value.start / 1440) * 1440 + clockMinute(time);
          let end = Math.floor(start / 1440) * 1440 + (value.end % 1440);
          if (end <= start) end += 1440;
          onChange({ ...value, start, end });
        }}
        onEndChange={(time) => {
          let end = Math.floor(value.start / 1440) * 1440 + clockMinute(time);
          if (end <= value.start) end += 1440;
          onChange({ ...value, end });
        }}
      />
      <InputField
        label={`${label} – Pause (Min.)`}
        keyboardType="number-pad"
        value={String(value.breakMinutes)}
        onChangeText={(text) =>
          onChange({ ...value, breakMinutes: text === "" ? 0 : Number(text) })
        }
      />
      <Action label={`${label} entfernen`} onPress={onRemove} />
    </View>
  );
}

export function SpecialDutyFields({
  value,
  onChange,
  startTime,
  endTime,
  timeZone,
  template = false,
  tariffFamily = null,
}: {
  readonly value: SpecialDuty | null;
  readonly onChange: (duty: SpecialDuty | null) => void;
  readonly startTime: string;
  readonly endTime: string;
  readonly timeZone: string;
  readonly template?: boolean;
  readonly tariffFamily?: DutyTariffFamily | null;
}) {
  const palette = usePalette();
  function choose(kind: string) {
    if (kind === "REGULAR") {
      onChange(null);
      return;
    }
    if (value?.kind !== kind)
      onChange(newSpecialDuty(kind as SpecialDuty["kind"], startTime, endTime, timeZone));
  }
  function addPart() {
    const duty =
      value?.kind === "SPLIT" ? value : newSpecialDuty("SPLIT", startTime, endTime, timeZone);
    const start = (duty.parts.at(-1)?.end ?? duty.endDay * 1440 + clockMinute(endTime)) + 60;
    onChange({ ...duty, parts: [...duty.parts, { start, end: start + 240, breakMinutes: 0 }] });
  }
  return (
    <EntryEditGroup testID="special-duty-fields">
      <Choice
        label="Dienstform"
        value={value?.kind ?? "REGULAR"}
        options={[
          { value: "REGULAR", label: "Regulärer Dienst" },
          ...Object.entries(DUTY_LABELS).map(([key, label]) => ({ value: key, label })),
        ]}
        onChange={choose}
      />
      {value ? (
        <>
          <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted, padding: 12 }]}>
            {value.kind === "ON_CALL"
              ? "Du bist erreichbar und arbeitest bei Bedarf. Nur tatsächliche Einsätze und Wege zählen hier zur erfassten Arbeitszeit. Bei stark eingeschränkter Freizeit kann die rechtliche Einordnung abweichen."
              : value.kind === "STANDBY"
                ? "Du bleibst vor Ort und arbeitest bei Bedarf. Der ganze Zeitraum zählt zur Arbeitsschutzzeit. Zeitgutschrift und Vergütung sind davon getrennt."
                : "Die Dienstteile gehören zusammen. Die Unterbrechung zählt nicht zur Arbeitszeit. Pausen innerhalb jedes Teils erfasst du getrennt."}
          </Text>
          <Choice
            label="Ende des ersten Zeitraums"
            value={String(value.endDay)}
            options={Array.from({ length: value.kind === "ON_CALL" ? 15 : 2 }, (_, day) => ({
              value: String(day),
              label: day === 0 ? "Gleicher Tag" : `${day} Tag${day === 1 ? "" : "e"} später`,
            }))}
            onChange={(day) => onChange({ ...value, endDay: Number(day) })}
          />
          {value.kind === "SPLIT"
            ? value.parts.map((part, index) => (
                <PartFields
                  key={index}
                  maxDay={1}
                  label={`Dienstteil ${index + 2}`}
                  value={part}
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
              ))
            : null}
          {value.kind === "ON_CALL" && !template ? (
            <>
              {value.callouts.map((call, index) => (
                <View key={index}>
                  <Choice
                    label={`Einsatz ${index + 1}`}
                    value={call.kind}
                    options={[
                      { value: "REMOTE", label: "Telefonisch / von zu Hause" },
                      { value: "ON_SITE", label: "Vor Ort" },
                    ]}
                    onChange={(kind) =>
                      onChange({
                        ...value,
                        callouts: value.callouts.map((item, i) =>
                          i === index
                            ? {
                                ...call,
                                kind: kind as "REMOTE" | "ON_SITE",
                                departure: call.start,
                                returned: call.end,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <PartFields
                    label={`Einsatz ${index + 1}`}
                    value={call}
                    maxDay={value.endDay}
                    onChange={(next) =>
                      onChange({
                        ...value,
                        callouts: value.callouts.map((item, i) =>
                          i === index
                            ? {
                                ...call,
                                ...next,
                                departure: next.start - (call.start - call.departure),
                                returned: next.end + (call.returned - call.end),
                              }
                            : item,
                        ),
                        calloutsComplete: false,
                      })
                    }
                    onRemove={() =>
                      onChange({
                        ...value,
                        callouts: value.callouts.filter((_, i) => i !== index),
                        calloutsComplete: false,
                      })
                    }
                  />
                  {call.kind === "ON_SITE" ? (
                    <>
                      <InputField
                        label={`Einsatz ${index + 1} – Hinweg (Min. unmittelbar davor)`}
                        keyboardType="number-pad"
                        value={String(call.start - call.departure)}
                        onChangeText={(text) =>
                          onChange({
                            ...value,
                            callouts: value.callouts.map((item, i) =>
                              i === index
                                ? { ...call, departure: call.start - Number(text) }
                                : item,
                            ),
                            calloutsComplete: false,
                          })
                        }
                      />
                      <InputField
                        label={`Einsatz ${index + 1} – Rückweg (Min. unmittelbar danach)`}
                        keyboardType="number-pad"
                        value={String(call.returned - call.end)}
                        onChangeText={(text) =>
                          onChange({
                            ...value,
                            callouts: value.callouts.map((item, i) =>
                              i === index ? { ...call, returned: call.end + Number(text) } : item,
                            ),
                            calloutsComplete: false,
                          })
                        }
                      />
                    </>
                  ) : null}
                </View>
              ))}
              {value.callouts.length < 64 ? (
                <Action
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
              <Choice
                label="Einsätze"
                value={value.calloutsComplete ? "COMPLETE" : "OPEN"}
                options={[
                  { value: "OPEN", label: "Noch nicht abgeschlossen" },
                  {
                    value: "COMPLETE",
                    label: value.callouts.length ? "Alle Einsätze erfasst" : "Kein Einsatz",
                  },
                ]}
                onChange={(status) =>
                  onChange({ ...value, calloutsComplete: status === "COMPLETE" })
                }
              />
            </>
          ) : null}
          {value.kind === "STANDBY" ? (
            <>
              <Choice
                label="Bereitschaftsstufe laut Vereinbarung"
                value={value.standbyLevel}
                options={[
                  { value: "UNKNOWN", label: "Weiß ich noch nicht" },
                  ...standbyLevels(tariffFamily).map((level) => ({
                    value: level,
                    label: `Stufe ${level}`,
                  })),
                ]}
                onChange={(level) =>
                  onChange({ ...value, standbyLevel: level as SpecialDuty["standbyLevel"] })
                }
              />
              <Choice
                label="Abgeltung"
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
            </>
          ) : null}
          {value.kind !== "SPLIT" ? (
            <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted, padding: 12 }]}>
              Die Abrechnung findest du unter Gehalt. Fehlende Angaben und noch offene Berechnungen
              werden dort getrennt angezeigt.
            </Text>
          ) : null}
        </>
      ) : null}
      {(!value || value.kind === "SPLIT") && (value?.parts.length ?? 0) < 8 ? (
        <Action label="Weiteren Dienstteil hinzufügen" onPress={addPart} />
      ) : null}
    </EntryEditGroup>
  );
}
