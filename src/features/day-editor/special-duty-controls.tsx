import { useState, type PropsWithChildren } from "react";
import {
  ActionSheetIOS,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { usePalette } from "@/theme/palette";
import { CONTROL_CORNERS, MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text, TextInput } from "@/ui/text";
import Ionicons from "@/ui/icon";

export function DutyValueRow({
  label,
  value,
  onPress,
  accessibilityLabel,
  expanded,
  stacked: forceStacked = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly expanded?: boolean;
  readonly stacked?: boolean;
}) {
  const palette = usePalette();
  const { fontScale, width } = useWindowDimensions();
  const stacked = forceStacked || fontScale >= 1.3 || width < 360;
  const content = (
    <>
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: stacked ? "column" : "row",
          alignItems: stacked ? "flex-start" : "center",
          gap: SPACING.xs,
        }}
      >
        <Text
          style={{
            ...TYPOGRAPHY.body,
            color: palette.text,
            flex: stacked ? undefined : 1,
            flexShrink: 1,
          }}
        >
          {label}
        </Text>
        {value ? (
          <Text
            style={{
              ...TYPOGRAPHY.body,
              color: palette.textSecondary,
              flexShrink: 1,
              maxWidth: "100%",
              textAlign: stacked ? "left" : "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {onPress ? (
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-forward"}
          size={16}
          color={palette.textSecondary}
          accessibilityElementsHidden
        />
      ) : null}
    </>
  );
  const style = {
    minHeight: MINIMUM_TOUCH_TARGET,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        { backgroundColor: pressed ? palette.surfaceMuted : "transparent" },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

export function DutyChoice({
  label,
  value,
  options,
  onChange,
  accessibilityLabel,
  stacked = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly onChange: (value: string) => void;
  readonly accessibilityLabel?: string;
  readonly stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return (
    <>
      <DutyValueRow
        label={label}
        value={selected}
        stacked={stacked}
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${selected}` : undefined}
        onPress={() => {
          if (Platform.OS !== "ios") {
            setOpen(!open);
            return;
          }
          ActionSheetIOS.showActionSheetWithOptions(
            {
              title: accessibilityLabel ?? label,
              options: [...options.map((option) => option.label), "Abbrechen"],
              cancelButtonIndex: options.length,
              userInterfaceStyle: palette.dark ? "dark" : "light",
            },
            (index) => {
              if (options[index]) onChange(options[index].value);
            },
          );
        }}
      />
      {open
        ? options.map((option) => (
            <DutyValueRow
              key={option.value}
              label={option.label}
              stacked={stacked}
              value={option.value === value ? "Ausgewählt" : ""}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))
        : null}
    </>
  );
}

export function DutyAction({
  label,
  onPress,
  destructive = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly destructive?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: MINIMUM_TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      {!destructive ? (
        <Ionicons name="add" size={20} color={palette.primary} accessibilityElementsHidden />
      ) : null}
      <Text
        style={{
          ...(destructive ? TYPOGRAPHY.small : TYPOGRAPHY.bodyStrong),
          color: destructive ? palette.danger : palette.primary,
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function DutyHeading({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      style={{
        ...TYPOGRAPHY.bodyStrong,
        color: palette.text,
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.lg,
        paddingBottom: SPACING.sm,
      }}
    >
      {children}
    </Text>
  );
}

export function DutyHint({
  children,
  error = false,
}: PropsWithChildren<{ readonly error?: boolean }>) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole={error ? "alert" : undefined}
      accessibilityLiveRegion={error ? "polite" : undefined}
      style={{
        ...TYPOGRAPHY.small,
        color: error ? palette.danger : palette.textSecondary,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
      }}
    >
      {children}
    </Text>
  );
}

export function DutyDivider() {
  const palette = usePalette();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.separator,
        marginHorizontal: SPACING.lg,
      }}
    />
  );
}

export function DutyMinutesField({
  label,
  accessibilityLabel,
  value,
  onChange,
}: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={{
        minHeight: MINIMUM_TOUCH_TARGET,
        flexDirection: fontScale >= 1.6 ? "column" : "row",
        alignItems: fontScale >= 1.6 ? "flex-start" : "center",
        gap: SPACING.sm,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.xs,
      }}
    >
      <Text
        style={{
          ...TYPOGRAPHY.body,
          color: palette.textSecondary,
          flex: fontScale >= 1.6 ? undefined : 1,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          ...CONTROL_CORNERS,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: palette.surfaceMuted,
          paddingHorizontal: SPACING.sm,
        }}
      >
        <TextInput
          accessibilityLabel={accessibilityLabel}
          keyboardType="number-pad"
          selectTextOnFocus
          maxLength={4}
          value={value}
          onChangeText={(text) => {
            if (/^\d*$/.test(text)) onChange(text);
          }}
          onSubmitEditing={Keyboard.dismiss}
          onBlur={() => {
            if (value === "") onChange("0");
          }}
          returnKeyType="done"
          style={{
            ...TYPOGRAPHY.body,
            color: palette.text,
            minHeight: MINIMUM_TOUCH_TARGET,
            minWidth: 48,
            width:
              Math.max(3, value.length) * TYPOGRAPHY.body.fontSize * 0.62 * fontScale + SPACING.md,
            textAlign: "right",
            fontVariant: ["tabular-nums"],
            paddingHorizontal: SPACING.xs,
          }}
        />
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textSecondary }}>Min.</Text>
      </View>
    </View>
  );
}
