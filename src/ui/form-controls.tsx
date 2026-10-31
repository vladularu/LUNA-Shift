import { Text, TextInput } from "@/ui/text";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Children, useId, type PropsWithChildren, type Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  useWindowDimensions,
  type StyleProp,
  type PressableStateCallbackType,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { usePressMotion } from "@/ui/press-motion";

export { SegmentedButton } from "@/ui/segmented-button";
export { ColorPicker } from "@/ui/color-picker";
export { DropdownField, type DropdownOption } from "@/ui/dropdown-field";

export function ResponsiveFieldRow({
  children,
  style,
}: PropsWithChildren<{ readonly style?: StyleProp<ViewStyle> }>) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;

  return (
    <View style={[{ flexDirection: stacked ? "column" : "row", gap: SPACING.md }, style]}>
      {Children.map(children, (child) => (
        <View style={{ flex: stacked ? undefined : 1 }}>{child}</View>
      ))}
    </View>
  );
}

function asTimeDate(value: string): Date {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute, 0, 0);
}

function asTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TimePickerField({
  label,
  accessibilityLabel,
  value,
  onChange,
  layout = "inline",
}: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly layout?: "inline" | "stacked";
}) {
  const palette = usePalette();
  const stacked = layout === "stacked";
  if (process.env.EXPO_OS === "web") {
    return (
      <Field
        autoCapitalize="none"
        accessibilityLabel={accessibilityLabel}
        label={label}
        maxLength={5}
        onChangeText={onChange}
        value={value}
      />
    );
  }
  if (process.env.EXPO_OS === "android") {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel ?? `${label}, ${value}. Uhrzeit wählen`}
        accessibilityRole="button"
        onPress={() => {
          DateTimePickerAndroid.open({
            display: "default",
            is24Hour: true,
            mode: "time",
            value: asTimeDate(value),
            onValueChange: (_, date) => onChange(asTimeString(date)),
          });
        }}
        style={({ pressed }) => ({
          borderCurve: CORNER_CURVE,
          minHeight: CONTROL_HEIGHT.large,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: SPACING.sm,
          borderRadius: RADII.control,
          backgroundColor: pressed ? palette.surfaceMuted : "transparent",
          paddingHorizontal: SPACING.sm,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: palette.textSecondary,
            ...(stacked ? TYPOGRAPHY.small : TYPOGRAPHY.bodyStrong),
          }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: palette.primary,
            ...TYPOGRAPHY.bodyStrong,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      </Pressable>
    );
  }
  return (
    <View
      style={{
        minHeight: CONTROL_HEIGHT.large,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: SPACING.sm,
      }}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{
          color: palette.textSecondary,
          ...(stacked ? TYPOGRAPHY.small : TYPOGRAPHY.bodyStrong),
        }}
      >
        {label}
      </Text>
      <DateTimePicker
        accessibilityLabel={accessibilityLabel ?? `${label} wählen`}
        style={stacked ? { minHeight: 44, alignSelf: "flex-start" } : undefined}
        display="compact"
        mode="time"
        onValueChange={(_, date) => onChange(asTimeString(date))}
        value={asTimeDate(value)}
      />
    </View>
  );
}

export function Field({
  error,
  inputRef,
  label,
  ...props
}: TextInputProps & {
  readonly error?: string | null;
  readonly inputRef?: Ref<TextInput>;
  readonly label: string;
}) {
  const palette = usePalette();
  const errorId = `${useId()}-error`;
  const { accessibilityHint, accessibilityLabel, accessibilityLiveRegion, style, ...inputProps } =
    props;
  return (
    <View style={{ gap: SPACING.xs }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.text, ...TYPOGRAPHY.label }}
      >
        {label}
      </Text>
      <TextInput
        ref={inputRef}
        hitSlop={2}
        accessibilityHint={error ? `Fehler: ${error}` : accessibilityHint}
        accessibilityLabel={accessibilityLabel ?? `${label}${error ? ", ungültig" : ""}`}
        accessibilityLiveRegion={error ? "polite" : accessibilityLiveRegion}
        aria-invalid={Boolean(error)}
        enablesReturnKeyAutomatically
        {...inputProps}
        placeholderTextColor={palette.textMuted}
        style={[
          {
            minHeight: inputProps.multiline ? 96 : CONTROL_HEIGHT.regular,
            borderWidth: 1,
            borderColor: error ? palette.danger : palette.border,
            borderRadius: RADII.control,
            borderCurve: CORNER_CURVE,
            backgroundColor: palette.surfaceRaised,
            color: palette.text,
            paddingHorizontal: SPACING.md,
            paddingVertical: (CONTROL_HEIGHT.regular - TYPOGRAPHY.input.lineHeight - 2) / 2,
            ...TYPOGRAPHY.input,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          nativeID={errorId}
          selectable
          style={{ color: palette.danger, ...TYPOGRAPHY.footnote }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type FormActionButtonProps = PropsWithChildren<{
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly tone: "primary" | "danger" | "secondary";
  readonly shape?: "rounded" | "pill";
}>;

function FormActionButton({
  busy = false,
  busyLabel,
  children,
  onPress,
  disabled = false,
  tone,
  shape = "rounded",
}: FormActionButtonProps) {
  const palette = usePalette();
  const pressMotion = usePressMotion();
  const secondary = tone === "secondary";
  const blocked = disabled || busy;
  const backgroundColor = tone === "danger" ? palette.dangerAction : palette.primaryAction;
  const foregroundColor = tone === "danger" ? palette.onDanger : palette.onPrimaryAction;

  return (
    <Animated.View style={[{ width: "100%" }, pressMotion.animatedStyle]}>
      <Pressable
        accessibilityLabel={busy ? busyLabel : undefined}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: blocked }}
        disabled={blocked}
        onPressIn={pressMotion.onPressIn}
        onPressOut={pressMotion.onPressOut}
        onPress={onPress}
        hitSlop={2}
        style={({ pressed }: PressableStateCallbackType) => ({
          width: "100%",
          minHeight:
            shape === "pill" ? 48 : secondary ? CONTROL_HEIGHT.regular : CONTROL_HEIGHT.large,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: secondary ? 1 : 0,
          borderColor: secondary ? palette.border : "transparent",
          borderRadius: shape === "pill" ? RADII.pill : RADII.control,
          borderCurve: CORNER_CURVE,
          backgroundColor: secondary
            ? pressed
              ? palette.surfaceMuted
              : palette.surfaceRaised
            : backgroundColor,
          opacity: blocked ? 0.5 : pressed ? 0.86 : 1,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
        })}
      >
        {busy ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={secondary ? palette.primary : foregroundColor}
            size="small"
          />
        ) : (
          <Text
            dynamicTypeRamp="headline"
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: secondary ? palette.primary : foregroundColor, ...TYPOGRAPHY.button }}
          >
            {children}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  danger = false,
  busy = false,
  busyLabel = "Wird gespeichert",
  shape,
}: PropsWithChildren<{
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly shape?: "rounded" | "pill";
  readonly busy?: boolean;
  readonly busyLabel?: string;
}>) {
  return (
    <FormActionButton
      busy={busy}
      busyLabel={busyLabel}
      disabled={disabled}
      onPress={onPress}
      tone={danger ? "danger" : "primary"}
      shape={shape}
    >
      {children}
    </FormActionButton>
  );
}

export function SecondaryButton({
  children,
  onPress,
  disabled = false,
  shape,
}: PropsWithChildren<{
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly shape?: "rounded" | "pill";
}>) {
  return (
    <FormActionButton disabled={disabled} onPress={onPress} tone="secondary" shape={shape}>
      {children}
    </FormActionButton>
  );
}
