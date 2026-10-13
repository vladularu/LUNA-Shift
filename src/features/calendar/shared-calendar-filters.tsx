import { Pressable, ScrollView, View } from "react-native";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { Text } from "@/ui/text";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { SharingStatus, useSharingAction } from "@/features/sharing/sharing-ui-elements";
import { TYPOGRAPHY } from "@/theme/typography";
import type { SharingController } from "@/domain/sharing-ui-contract";

export function SharedCalendarFilters(props: {
  readonly ownVisible: boolean;
  readonly onOwnVisible: (visible: boolean) => void;
}) {
  const controller = useSharingUiController();
  if (!controller) return null;
  return <Filters {...props} controller={controller} />;
}
function Filters({
  controller,
  ownVisible,
  onOwnVisible,
}: {
  readonly controller: SharingController;
  readonly ownVisible: boolean;
  readonly onOwnVisible: (visible: boolean) => void;
}) {
  const palette = usePalette();
  const action = useSharingAction(controller);
  const rows = [
    { id: "own", name: "Du", color: palette.text, visible: ownVisible },
    ...controller.calendars.filter((item) => !item.isOwner),
  ];
  return (
    <View>
      <ScrollView
        testID="calendar-person-filter-viewport"
        horizontal
        style={{ height: MINIMUM_TOUCH_TARGET, flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.xs }}
      >
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} anzeigen`}
            accessibilityState={{ selected: row.visible, disabled: action.busy }}
            disabled={action.busy}
            onPress={() => {
              if (row.id === "own") onOwnVisible(!ownVisible);
              else void action.run(() => controller.setVisible(row.id, !row.visible));
            }}
            style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center" }}
          >
            <View
              style={{
                minHeight: 28,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                borderRadius: RADII.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: row.visible ? palette.surface : "transparent",
                opacity: row.visible ? 1 : 0.6,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: RADII.pill,
                  backgroundColor: row.color,
                }}
              />
              <Text style={{ ...TYPOGRAPHY.caption, color: palette.text }}>{row.name}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <SharingStatus busy={false} failed={action.failed} />
    </View>
  );
}
