import Ionicons from "@/ui/icon";
import { useEffect } from "react";
import { AccessibilityInfo, View, useWindowDimensions } from "react-native";
import { CALENDAR_IMAGE_STRENGTH_OPTIONS } from "@/theme/calendar-image";
import { useCalendarBackground } from "./calendar-background-context";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import {
  CardSeparator,
  InlineNotice,
  RowButton,
  SegmentedControl,
  SurfaceCard,
} from "@/ui/design-system";
import { SelectionGroup } from "@/ui/selection-group";
import { selectionFeedback } from "@/ui/haptics";

export function CalendarBackgroundControl() {
  const background = useCalendarBackground();
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  const disabled = !background.supported || !background.ready || background.busy;
  useEffect(() => {
    if (background.canUndoRemoval)
      AccessibilityInfo.announceForAccessibility("Foto entfernt. Rückgängig ist verfügbar.");
  }, [background.canUndoRemoval]);
  return (
    <>
      <SelectionGroup title="Kalenderhintergrund" testID="calendar-background-settings">
        <SegmentedControl
          accessibilityLabel="Kalenderhintergrund"
          items={[
            { value: "standard", label: "LUNA Standard" },
            { value: "photo", label: "Eigenes Foto" },
          ]}
          value={background.uri ? "photo" : "standard"}
          stacked={stacked}
          disabled={disabled}
          onChange={(value) => {
            if (value === "standard" && background.uri) void background.remove();
            if (value === "photo" && !background.uri) {
              if (background.canUndoRemoval) void background.undoRemove();
              else void background.choose();
            }
          }}
        />
      </SelectionGroup>
      {background.uri ? (
        <SelectionGroup title="Bildsichtbarkeit" testID="calendar-image-strength-settings">
          <SegmentedControl
            accessibilityLabel="Bildsichtbarkeit"
            value={String(background.strength)}
            disabled={disabled}
            stacked={stacked}
            items={CALENDAR_IMAGE_STRENGTH_OPTIONS.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
            onChange={(value) => {
              const option = CALENDAR_IMAGE_STRENGTH_OPTIONS.find(
                (candidate) => String(candidate.value) === value,
              );
              if (option && background.strength !== option.value) {
                selectionFeedback();
                void background.setStrength(option.value);
              }
            }}
          />
        </SelectionGroup>
      ) : null}
      <SurfaceCard testID="calendar-photo-actions">
        <RowButton
          title={background.uri ? "Foto ändern" : "Foto auswählen"}
          disabled={disabled}
          onPress={() => void background.choose()}
          accessibilityHint="Das Kalenderfoto bleibt nur auf diesem Gerät."
          leading={
            <Ionicons name="image-outline" size={24} color={palette.primary} accessible={false} />
          }
        />
        {background.uri ? (
          <>
            <CardSeparator inset={0} />
            <RowButton
              title="Foto entfernen"
              destructive
              disabled={disabled}
              onPress={() => void background.remove()}
              trailing={<></>}
              accessibilityHint="Setzt nur den Kalenderhintergrund zurück. Du kannst das Entfernen rückgängig machen."
              leading={
                <Ionicons
                  name="trash-outline"
                  size={24}
                  color={palette.danger}
                  accessible={false}
                />
              }
            />
          </>
        ) : null}
        {background.canUndoRemoval ? (
          <>
            <CardSeparator inset={0} />
            <RowButton
              title="Rückgängig"
              disabled={disabled}
              onPress={() => void background.undoRemove()}
              trailing={<></>}
              accessibilityHint="Stellt dein zuletzt entferntes Kalenderfoto wieder her."
              leading={
                <Ionicons
                  name="arrow-undo-outline"
                  size={24}
                  color={palette.primary}
                  accessible={false}
                />
              }
            />
          </>
        ) : null}
      </SurfaceCard>
      {background.error ? (
        <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
          <InlineNotice message={background.error} />
          <RowButton
            title="Kalenderbild erneut laden"
            disabled={background.busy}
            onPress={background.retry}
          />
        </View>
      ) : null}
    </>
  );
}
