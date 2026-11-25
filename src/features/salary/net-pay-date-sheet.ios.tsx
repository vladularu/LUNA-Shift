import {
  BottomSheet,
  Button,
  DatePicker,
  Group,
  Host,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  datePickerStyle,
  disabled as disable,
  environment,
  font,
  frame,
  interactiveDismissDisabled,
  labelsHidden,
  padding,
  presentationDragIndicator,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import type { NetPayDateSheetProps } from "./net-pay-date-sheet";

export function NetPayDateSheet({
  visible,
  disabled,
  value,
  minimumDate,
  maximumDate,
  onChange,
  onConfirm,
  onClose,
}: NetPayDateSheetProps) {
  const palette = usePalette();
  return (
    <Host
      style={{ position: "absolute" }}
      pointerEvents="none"
      colorScheme={palette.dark ? "dark" : "light"}
    >
      <BottomSheet
        testID="net-pay-native-date-sheet"
        isPresented={visible}
        fitToContents
        onIsPresentedChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Group
          modifiers={[presentationDragIndicator("visible"), interactiveDismissDisabled(disabled)]}
        >
          <VStack
            spacing={SPACING.md}
            modifiers={[frame({ maxWidth: Infinity }), padding({ all: SPACING.lg })]}
          >
            <HStack modifiers={[frame({ minHeight: MINIMUM_TOUCH_TARGET })]}>
              <Text modifiers={[font({ textStyle: "headline" })]}>Geburtsdatum</Text>
              <Spacer />
              <Button
                label="Abbrechen"
                testID="net-pay-date-cancel"
                onPress={onClose}
                modifiers={[disable(disabled)]}
              />
            </HStack>
            <DatePicker
              title="Geburtsdatum"
              testID="net-pay-native-birth-date"
              selection={value}
              range={{ start: minimumDate, end: maximumDate }}
              displayedComponents={["date"]}
              onDateChange={onChange}
              modifiers={[
                datePickerStyle("wheel"),
                environment("locale", "de_DE"),
                labelsHidden(),
                disable(disabled),
              ]}
            />
            <Button
              label="Datum übernehmen"
              testID="net-pay-date-confirm"
              onPress={onConfirm}
              modifiers={[
                buttonStyle("borderedProminent"),
                tint(palette.primaryAction),
                disable(disabled),
              ]}
            />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
