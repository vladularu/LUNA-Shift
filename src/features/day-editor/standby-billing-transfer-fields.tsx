import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ShiftEntry } from "@/domain/types";
import { formatDateTitle } from "@/engine/calendar";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { usePalette } from "@/theme/palette";
import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { SelectionSheet } from "@/ui/selection-sheet";
import { DutyHint, DutyValueRow } from "./special-duty-controls";

export function StandbyBillingTransferFields({
  candidates,
  selected,
  onChange,
}: {
  readonly candidates: readonly ShiftEntry[];
  readonly selected: readonly ShiftEntry[];
  readonly onChange: (entries: readonly ShiftEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  if (!candidates.length && !selected.length) return null;
  return (
    <>
      <DutyValueRow
        label="Für weitere passende Dienste übernehmen"
        value={selected.length ? `${selected.length} ausgewählt` : "Auswählen"}
        onPress={() => setOpen(true)}
        stacked
      />
      {open ? (
        <SelectionSheet
          title="Passende Dienste"
          visible
          cancelLabel="Fertig"
          onClose={() => setOpen(false)}
        >
          {() => (
            <View>
              <DutyHint>
                Gleiche bisherige Abrechnung im selben Beschäftigungszeitraum. Erst beim Speichern
                werden Stufe, Ausgleich und Abrechnungsgrundlage übernommen. Zeiten, Pausen,
                Einsätze und die jeweilige Dienstnummer bleiben erhalten.
              </DutyHint>
              {candidates.map((entry) => {
                const checked = selected.some((item) => item.id === entry.id);
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${formatDateTitle(entry.date)}, ${entry.title}`}
                    accessibilityState={{ checked }}
                    onPress={() =>
                      onChange(
                        checked
                          ? selected.filter((item) => item.id !== entry.id)
                          : [...selected, entry],
                      )
                    }
                    style={({ pressed }) => ({
                      minHeight: 48,
                      padding: SPACING.lg,
                      gap: SPACING.md,
                      flexDirection: "row",
                      alignItems: "center",
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <View style={{ flex: 1, gap: SPACING.xxs }}>
                      <Text style={[TYPOGRAPHY.body, { color: palette.text }]}>
                        {formatDateTitle(entry.date)}
                      </Text>
                      <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                        {entry.title} · {entry.startTime}–{entry.endTime}
                      </Text>
                    </View>
                    <Ionicons
                      name={checked ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={checked ? palette.text : palette.textMuted}
                    />
                  </Pressable>
                );
              })}
              {selected.length ? (
                <DutyValueRow label="Auswahl zurücksetzen" value="" onPress={() => onChange([])} />
              ) : null}
            </View>
          )}
        </SelectionSheet>
      ) : null}
    </>
  );
}
