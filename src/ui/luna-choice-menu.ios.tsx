import { View } from "react-native";
import { Host, HStack, Image, Menu, Picker, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  menuOrder,
  padding,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { Text as LunaText } from "@/ui/text";
import type { LunaChoiceMenuProps } from "./luna-choice-menu";

export function LunaChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled: locked = false,
  compact = false,
  displayLabel = label,
  accessibilityLabel: spokenLabel,
  testPrefix = compact ? "net-pay-native" : "salary-payment-native",
  field,
}: LunaChoiceMenuProps<T>) {
  const palette = usePalette();
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? (compact || field ? "Bitte auswählen" : "Auswählen");
  const inline = field?.inlineLabel;
  const testIDSuffix = compact || field ? `:${label}` : "";
  const labelPadding = inline
    ? { all: 0 }
    : compact
      ? { all: SPACING.lg }
      : { horizontal: SPACING.md, vertical: SPACING.xs };

  return (
    <View style={{ gap: SPACING.xs }}>
      {compact || inline ? null : (
        <LunaText
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={
            field
              ? { color: palette.text, ...TYPOGRAPHY.label }
              : { color: palette.textMuted, ...TYPOGRAPHY.caption }
          }
        >
          {displayLabel}
        </LunaText>
      )}
      <View
        style={{
          ...(compact
            ? null
            : {
                borderColor: palette.border,
                borderWidth: 1,
                borderRadius: RADII.control,
              }),
          ...(field && {
            backgroundColor: palette.surface,
            borderColor: field.error ? palette.danger : palette.border,
            borderWidth: inline ? 0 : 1,
          }),
          opacity: locked ? 0.55 : 1,
        }}
      >
        <Host matchContents={{ vertical: true }} colorScheme={palette.dark ? "dark" : "light"}>
          <Menu
            testID={`${testPrefix}-menu${testIDSuffix}`}
            label={
              <HStack
                modifiers={[
                  padding(labelPadding),
                  frame({
                    minHeight: field && !inline ? CONTROL_HEIGHT.large : MINIMUM_TOUCH_TARGET,
                  }),
                ]}
              >
                {field?.leadingSymbol ? (
                  <Image systemName={field.leadingSymbol} color={palette.textMuted} size={16} />
                ) : null}
                {inline ? (
                  <>
                    <Text modifiers={[foregroundStyle(palette.textMuted)]}>{displayLabel}</Text>
                    <Spacer />
                  </>
                ) : null}
                {compact ? (
                  <VStack alignment="leading" spacing={SPACING.xs}>
                    <Text
                      modifiers={[
                        font({ textStyle: "footnote" }),
                        foregroundStyle(palette.textMuted),
                      ]}
                    >
                      {displayLabel}
                    </Text>
                    <Text
                      modifiers={[foregroundStyle(selected ? palette.text : palette.textMuted)]}
                    >
                      {selectedLabel}
                    </Text>
                  </VStack>
                ) : (
                  <Text
                    modifiers={[
                      foregroundStyle(field && !selected ? palette.textMuted : palette.text),
                    ]}
                  >
                    {selectedLabel}
                  </Text>
                )}
                {inline ? null : <Spacer />}
                <Image systemName="chevron.up.chevron.down" color={palette.textMuted} size={14} />
              </HStack>
            }
            modifiers={[
              buttonStyle("plain"),
              menuOrder("fixed"),
              accessibilityLabel(spokenLabel ?? `${label} auswählen`),
              accessibilityValue(selectedLabel),
              ...(field?.error ? [accessibilityHint(field.error)] : []),
              disabled(locked),
            ]}
          >
            <Picker<T | null>
              testID={`${testPrefix}-options${testIDSuffix}`}
              label={label}
              selection={value}
              onSelectionChange={(selection) => {
                const option = options.find((item) => item.value === selection);
                if (option && !locked) onChange(option.value);
              }}
              modifiers={[pickerStyle("inline")]}
            >
              {options.map((option) => (
                <Text
                  key={option.value}
                  testID={compact ? `${testPrefix}-option:${option.label}` : undefined}
                  modifiers={[tag(option.value)]}
                >
                  {option.label}
                </Text>
              ))}
            </Picker>
          </Menu>
        </Host>
      </View>
    </View>
  );
}
