import Ionicons from "@/ui/icon";
import { useEffect } from "react";
import { AccessibilityInfo, Image, View, useWindowDimensions } from "react-native";
import { calendarImageOpacityPercentage } from "@/theme/calendar-image";
import { CalendarImageOpacityControl } from "./calendar-image-opacity-control";
import { useCalendarBackground } from "./calendar-background-context";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
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
      <SelectionGroup title="Hintergrund" testID="calendar-background-settings">
        <SurfaceCard testID="calendar-photo-actions">
          <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
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
          </View>
          <RowButton
            title={background.uri ? "Foto ändern" : "Foto auswählen"}
            disabled={disabled}
            onPress={() => void background.choose()}
            accessibilityHint="Das Kalenderfoto bleibt nur auf diesem Gerät."
            leading={
              background.uri ? (
                <Image
                  source={{ uri: background.uri }}
                  accessible={false}
                  style={{ width: SPACING.xxl, height: SPACING.xxl, borderRadius: RADII.control }}
                />
              ) : (
                <Ionicons
                  name="image-outline"
                  size={24}
                  color={palette.primary}
                  accessible={false}
                />
              )
            }
            trailing={<></>}
          />
          {background.uri ? (
            <>
              <CardSeparator inset={0} />
              <View style={{ padding: SPACING.lg }}>
                <CalendarImageOpacityControl
                  value={calendarImageOpacityPercentage(
                    background.previewStrength ?? background.strength,
                  )}
                  disabled={disabled}
                  onPreview={(value) => background.setPreviewStrength?.(value)}
                  onCommit={(value) => {
                    selectionFeedback();
                    void background.setStrength(value);
                  }}
                />
              </View>
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
      </SelectionGroup>
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
