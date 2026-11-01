import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { isCheckScopeNotice } from "./check-visibility";

export function CheckScopeDisclosure({
  issues = [],
  shifts = [],
  scopeCount = 0,
}: {
  readonly issues?: readonly ComplianceIssue[];
  readonly shifts?: readonly ShiftEntry[];
  readonly scopeCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const palette = usePalette();
  const notes = issues.filter(isCheckScopeNotice);
  if (notes.length === 0 && scopeCount === 0) return null;
  const ids = new Set(notes.flatMap((note) => note.relatedShiftIds));
  const kinds = new Set(
    shifts.filter((shift) => ids.has(shift.id)).map((shift) => shift.specialDuty?.kind),
  );
  return (
    <View testID="check-scope" style={{ gap: SPACING.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Prüfumfang eingeschränkt"
        accessibilityHint="Zeigt die Grenzen der Bereitschaftsprüfung"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({
          minHeight: MINIMUM_TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          paddingVertical: SPACING.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={palette.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, flex: 1 }}>
          Prüfumfang eingeschränkt
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={palette.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {expanded ? (
        <View testID="check-scope-details" style={{ gap: SPACING.sm }}>
          {kinds.has("STANDBY") ? (
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
              Bereitschaftsdienst wird als Arbeitszeit berücksichtigt. Betriebliche Ausnahmen und
              Ausgleichszeiträume kann LUNA nicht abschließend prüfen.
            </Text>
          ) : null}
          {kinds.has("ON_CALL") ? (
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
              Bei Rufbereitschaft werden erfasste Einsätze berücksichtigt. Weitere Einschränkungen
              der Freizeit und besondere Ruhezeitregelungen sind nicht abschließend geprüft.
            </Text>
          ) : null}
          {!kinds.has("STANDBY") && !kinds.has("ON_CALL") ? (
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
              Besondere Voraussetzungen und Ausnahmen für Bereitschaften sind nicht abschließend
              geprüft. Die Details findest du in der Prüfung des jeweiligen Monats.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
