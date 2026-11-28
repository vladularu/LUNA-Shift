import type { ShiftEntry, UserProfile } from "@/domain/types";
import { useAbsencePayPreview } from "./use-absence-pay-preview";
import { useState } from "react";
import { absencePayTariffAt, type AbsencePayFacts } from "@/domain/absence-pay";
import { SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { Text } from "@/ui/text";
import { EntryEditGroup, EntryEditValueRow } from "./entry-edit-fields";

export function absencePayEditor(
  profile: UserProfile | null,
  date: string,
  type: string,
  value: AbsencePayFacts | null,
  original: ShiftEntry | null,
) {
  if (!profile || (type !== "VACATION" && type !== "SICK")) return undefined;
  if (!absencePayTariffAt(profile, date)) return undefined;
  return (
    <CalendarAbsencePay
      profile={profile}
      date={date}
      type={type}
      original={original}
      value={value}
    />
  );
}
function CalendarAbsencePay(props: Parameters<typeof useAbsencePayPreview>[0]) {
  const preview = useAbsencePayPreview(props);
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  return (
    <EntryEditGroup>
      <EntryEditValueRow
        label={preview.label ?? "U/K-Aufschlag"}
        value={preview.value}
        onPress={preview.detail ? () => setOpen(!open) : undefined}
      />
      {(preview.reason || (open && preview.detail)) && (
        <Text
          style={{
            paddingHorizontal: SPACING.lg,
            paddingBottom: SPACING.sm,
            color: palette.textMuted,
          }}
        >
          {preview.reason ?? preview.detail}
        </Text>
      )}
    </EntryEditGroup>
  );
}
