import { View, useWindowDimensions } from "react-native";
import { dutyClock, type DutyPart } from "@/domain/special-duty";
import { SPACING } from "@/theme/tokens";
import { TimePickerField } from "@/ui/form-controls";
import { PausePicker } from "@/ui/pause-picker";
import { DutyAction, DutyChoice, DutyHeading, DutyHint } from "./special-duty-controls";
import { changeDutyClock, dutyDayLabel } from "./special-duty-form-state";

export function DutyTimeBlock({
  title,
  value,
  onChange,
  onRemove,
  maxDay = 1,
  fixedStartDay = false,
  hidePause = false,
  error,
  parentFields,
}: {
  readonly title: string;
  readonly value: DutyPart;
  readonly onChange: (value: DutyPart) => void;
  readonly onRemove?: () => void;
  readonly maxDay?: number;
  readonly fixedStartDay?: boolean;
  readonly hidePause?: boolean;
  readonly error?: string | null;
  readonly parentFields?: {
    readonly startTime: string;
    readonly endTime: string;
    readonly breakMinutes: string;
    readonly onStartChange: (value: string) => void;
    readonly onEndChange: (value: string) => void;
    readonly onPauseChange: (value: string) => void;
  };
}) {
  const { fontScale } = useWindowDimensions();
  const startDay = Number.isFinite(value.start) ? Math.floor(value.start / 1440) : 0;
  const endDay = Number.isFinite(value.end) ? Math.floor(value.end / 1440) : 0;
  const options = Array.from({ length: maxDay + 1 }, (_, day) => ({
    value: String(day),
    label: dutyDayLabel(day),
  }));
  return (
    <View testID={`duty-block-${title}`}>
      <DutyHeading>{title}</DutyHeading>
      <View style={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs }}>
        <TimePickerField
          label="Beginn"
          accessibilityLabel={`${title}: Beginn wählen`}
          layout={fontScale >= 1.6 ? "stacked" : "inline"}
          value={parentFields?.startTime ?? dutyClock(value.start)}
          onChange={
            parentFields?.onStartChange ??
            ((time) => onChange(changeDutyClock(value, "start", time)))
          }
        />
      </View>
      {!fixedStartDay ? (
        <DutyChoice
          label="Beginn am"
          accessibilityLabel={`${title}: Beginn am`}
          value={String(startDay)}
          options={options}
          onChange={(day) => {
            const delta = (Number(day) - startDay) * 1440;
            onChange({ ...value, start: value.start + delta, end: value.end + delta });
          }}
        />
      ) : null}
      <View style={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs }}>
        <TimePickerField
          label="Ende"
          accessibilityLabel={`${title}: Ende wählen`}
          layout={fontScale >= 1.6 ? "stacked" : "inline"}
          value={parentFields?.endTime ?? dutyClock(value.end)}
          onChange={
            parentFields?.onEndChange ?? ((time) => onChange(changeDutyClock(value, "end", time)))
          }
        />
      </View>
      <DutyChoice
        label="Ende am"
        accessibilityLabel={`${title}: Ende am`}
        value={String(endDay)}
        options={options}
        onChange={(day) => onChange({ ...value, end: Number(day) * 1440 + (value.end % 1440) })}
      />
      {!hidePause ? (
        <PausePicker
          embedded
          testID={`duty-pause-${title}`}
          accessibilityLabel={`${title}: Pause`}
          value={parentFields?.breakMinutes ?? String(value.breakMinutes)}
          onChange={
            parentFields?.onPauseChange ??
            ((text) => onChange({ ...value, breakMinutes: Number(text) }))
          }
        />
      ) : null}
      {error ? <DutyHint error>{error}</DutyHint> : null}
      {onRemove ? <DutyAction destructive label={`${title} entfernen`} onPress={onRemove} /> : null}
    </View>
  );
}
