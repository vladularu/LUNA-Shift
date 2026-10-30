import { useState } from "react";
import { View } from "react-native";
import { clockMinute, dutyClock, type SpecialDuty } from "@/domain/special-duty";
import { EntryEditTimeRow, EntryEditValueRow } from "./entry-edit-fields";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";

/** Opening the picker never invents a recorded break; the user confirms its start. */
export function StandbyBreakFields({
  value,
  startTime,
  endTime,
  breakMinutes,
  onChange,
}: {
  readonly value: SpecialDuty;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly onChange: (value: SpecialDuty) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(dutyClock(value.breakStart ?? clockMinute(startTime)));
  const palette = usePalette();
  if (
    value.kind !== "STANDBY" ||
    breakMinutes <= 0 ||
    (value.breakStart == null &&
      value.endDay === 0 &&
      clockMinute(startTime) >= 360 &&
      clockMinute(endTime) <= 1200)
  )
    return null;
  const update = (breakStart: number | null) =>
    onChange({
      ...value,
      version: 3,
      standbyAgreement: value.standbyAgreement ?? null,
      breakStart,
    });
  return (
    <View>
      <EntryEditValueRow
        label="Pausenbeginn"
        value={
          value.breakStart == null
            ? "Noch offen"
            : `${dutyClock(value.breakStart)}${value.breakStart >= 1440 ? " · Folgetag" : ""}`
        }
        onPress={() => {
          setDraft(dutyClock(value.breakStart ?? clockMinute(startTime)));
          setOpen(!open);
        }}
      />
      {open ? (
        <>
          <EntryEditTimeRow label="Beginn der echten Pause" value={draft} onChange={setDraft} />
          <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted, padding: 12 }]}>
            Nur eine Pause ohne Bereitschaftspflicht. Der Beginn ordnet Nacht- und
            Feiertagszuschläge richtig zu.
          </Text>
          <EntryEditValueRow
            label="Pausenbeginn übernehmen"
            value={draft}
            onPress={() => {
              const minute = clockMinute(draft);
              update(minute < clockMinute(startTime) ? minute + 1440 : minute);
              setOpen(false);
            }}
          />
          {value.breakStart != null ? (
            <EntryEditValueRow
              label="Pausenbeginn offen lassen"
              value=""
              onPress={() => {
                update(null);
                setOpen(false);
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
