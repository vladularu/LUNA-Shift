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
  layout,
  displayLabel = label,
  displayValue,
  accessibilityLabel: spokenLabel,
  testPrefix = compact ? "net-pay-native" : "salary-payment-native",
  field,
}: LunaChoiceMenuProps<T>) {
  const palette = usePalette();
  const selected = options.find((option) => option.value === value);
  const selectedLabel =
    displayValue ?? selected?.label ?? (compact || field ? "Bitte auswählen" : "Auswählen");
  const embedded = compact || layout !== undefined;
  const inline = layout === "inline";
  const stackedField = layout === "field";
  const inlineField = field?.inlineLabel;
  const isLabelInRow = layout === "row" || inlineField;
  const testIDSuffix = compact || field ? `:${label}` : "";
  const labelModifiers = [foregroundStyle(palette.textMuted)];
  const valueModifiers = inline
    ? [font({ textStyle: "subheadline" }), ...labelModifiers]
    : [foregroundStyle(selected ? palette.text : palette.textMuted)];

  return (
    <View style={{ gap: stackedField ? 0 : SPACING.xs }}>
      {stackedField || (!embedded && !inlineField) ? (
        <LunaText
          accessibilityElementsHidden={stackedField}
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: field && !stackedField ? palette.text : palette.textMuted,
            ...(stackedField ? TYPOGRAPHY.small : field ? TYPOGRAPHY.label : TYPOGRAPHY.caption),
          }}
        >
          {displayLabel}
        </LunaText>
      ) : null}
      <View
        style={{
          ...(embedded || inlineField
            ? null
            : {
                borderColor: palette.border,
                borderWidth: 1,
                borderRadius: RADII.control,
              }),
          ...(field && {
            backgroundColor: palette.surface,
            borderColor: field.error ? palette.danger : palette.border,
            borderWidth: inlineField ? 0 : 1,
          }),
          opacity: locked ? 0.55 : 1,
        }}
      >
        <Host
          matchContents={inline ? true : { vertical: true }}
          colorScheme={palette.dark ? "dark" : "light"}
        >
          <Menu
            testID={`${testPrefix}-menu${testIDSuffix}`}
            label={
              <HStack
                spacing={stackedField ? SPACING.xs : undefined}
                modifiers={[
                  padding(
                    inlineField
                      ? { all: 0 }
                      : layout === "row"
                        ? { horizontal: SPACING.lg, vertical: SPACING.sm }
                        : stackedField
                          ? { horizontal: SPACING.md }
                          : inline
                            ? { vertical: SPACING.xxs }
                            : compact
                              ? { all: SPACING.lg }
                              : { horizontal: SPACING.md, vertical: SPACING.xs },
                  ),
                  frame({
                    minHeight: field && !inlineField ? CONTROL_HEIGHT.large : MINIMUM_TOUCH_TARGET,
                  }),
                ]}
              >
                {field?.leadingSymbol ? (
                  <Image systemName={field.leadingSymbol} color={palette.textMuted} size={16} />
                ) : null}
                {isLabelInRow ? (
                  <>
                    <Text modifiers={labelModifiers}>{displayLabel}</Text>
                    <Spacer />
                    <Text modifiers={valueModifiers}>{selectedLabel}</Text>
                  </>
                ) : stackedField ? (
                  <Text modifiers={[font({ textStyle: "callout" }), ...valueModifiers]}>
                    {selectedLabel}
                  </Text>
                ) : compact ? (
                  <VStack alignment="leading" spacing={SPACING.xs}>
                    <Text
                      modifiers={[
                        font({ textStyle: "footnote" }),
                        foregroundStyle(palette.textMuted),
                      ]}
                    >
                      {displayLabel}
                    </Text>
                    <Text modifiers={valueModifiers}>{selectedLabel}</Text>
                  </VStack>
                ) : (
                  <Text
                    modifiers={inline || field ? valueModifiers : [foregroundStyle(palette.text)]}
                  >
                    {selectedLabel}
                  </Text>
                )}
                {inline || isLabelInRow || stackedField ? null : <Spacer />}
                <Image systemName="chevron.up.chevron.down" color={palette.textMuted} size={14} />
                {stackedField ? <Spacer minLength={0} /> : null}
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
                  testID={embedded ? `${testPrefix}-option:${option.label}` : undefined}
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
