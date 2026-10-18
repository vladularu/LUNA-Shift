import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { CalendarBackgroundControl } from "./calendar-background-control";
import { useCalendarBackground } from "./calendar-background-context";
import { useAppearancePreferences } from "./appearance-preferences";
import { AppearanceCalendarPreview } from "./appearance-calendar-preview";
import { AppearanceModeControl } from "./appearance-mode-control";
import { CalendarDisplayControls } from "./calendar-display-controls";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { InlineNotice, RowButton } from "@/ui/design-system";
import { SelectionGroup } from "@/ui/selection-group";
import { ScreenScrollView } from "@/ui/screen-layout";
import { confirmDestructiveAction } from "@/ui/confirm-action";

export function CalendarDesignScreen({
  notice,
  bottomPadding = SPACING.lg,
}: {
  readonly notice?: string;
  readonly bottomPadding?: number;
}) {
  const palette = usePalette();
  const appearance = useAppearancePreferences();
  const display = useCalendarPreferences();
  const background = useCalendarBackground();
  const resetDisabled =
    !display.ready ||
    display.saving ||
    background.busy ||
    (background.supported && !background.ready);
  function confirmReset() {
    confirmDestructiveAction({
      title: "Kalenderoptionen zurücksetzen?",
      message:
        "Dein Kalenderfoto wird entfernt und die Kalenderanzeige zurückgesetzt. Das lässt sich nicht rückgängig machen. Hell-/Dunkelmodus, Schichtfarben, Profile und Dienste bleiben erhalten.",
      confirmLabel: "Zurücksetzen",
      onConfirm: () => {
        void (async () => {
          if (!background.supported || (await background.reset())) display.resetDisplay();
        })();
      },
    });
  }
  return (
    <ScreenScrollView
      surface="groupedBackground"
      contentGap={SCREEN_LAYOUT.sectionGap}
      bottomPadding={bottomPadding}
    >
      {notice ? <InlineNotice message={notice} /> : null}
      <AppearanceCalendarPreview />
      <SelectionGroup title="Darstellung" testID="appearance-settings">
        <AppearanceModeControl
          value={appearance.mode}
          onChange={appearance.setMode}
          disabled={!appearance.ready}
        />
      </SelectionGroup>
      {appearance.error ? (
        <View style={{ gap: SPACING.sm }}>
          <InlineNotice message={appearance.error} />
          <RowButton title="Modus erneut speichern" onPress={appearance.retry} />
        </View>
      ) : null}
      <CalendarBackgroundControl />
      <CalendarDisplayControls />
      {display.error ? (
        <View style={{ gap: SPACING.sm }}>
          <InlineNotice message={display.error} />
          <RowButton title="Kalenderoptionen erneut versuchen" onPress={display.retry} />
        </View>
      ) : null}
      <Pressable
        hitSlop={2}
        accessibilityRole="button"
        disabled={resetDisabled}
        accessibilityState={{ disabled: resetDisabled }}
        onPress={confirmReset}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          justifyContent: "center",
          paddingVertical: SPACING.sm,
          opacity: resetDisabled ? 0.5 : pressed ? 0.75 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}
        >
          Kalenderoptionen zurücksetzen
        </Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}
      >
        {appearance.saving || display.saving || background.busy
          ? "Wird gespeichert …"
          : appearance.error || display.error || background.error
            ? "Nicht alle Änderungen wurden gespeichert."
            : "Änderungen werden automatisch gespeichert."}
      </Text>
    </ScreenScrollView>
  );
}
