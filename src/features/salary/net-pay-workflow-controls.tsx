import { useState, type PropsWithChildren } from "react";
import { Text } from "@/ui/text";
import {
  ActionSheetIOS,
  Keyboard,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import Ionicons from "@/ui/icon";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";

import { Field, PrimaryButton } from "@/ui/form-controls";
import { SelectionSheet } from "@/ui/selection-sheet";

export function NetPayWorkflowText({
  children,
  centered = false,
}: PropsWithChildren<{ readonly centered?: boolean }>) {
  const palette = usePalette();
  return (
    <Text
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      style={{
        color: palette.textMuted,
        ...TYPOGRAPHY.caption,
        ...(centered ? { textAlign: "center" as const } : {}),
      }}
    >
      {children}
    </Text>
  );
}

export function NetPayWorkflowAction({
  children,
  onPress,
  disabled = false,
  busy = false,
}: PropsWithChildren<{
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}>) {
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 120 }}>
      <PrimaryButton onPress={onPress} disabled={disabled} busy={busy}>
        {children}
      </PrimaryButton>
    </View>
  );
}

export function NetPayWorkflowLink({
  children,
  onPress,
  disabled = false,
  expanded,
}: PropsWithChildren<{
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
}>) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.sm,
        paddingVertical: 8,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.primary, ...TYPOGRAPHY.caption, fontWeight: "600", flexShrink: 1 }}
      >
        {children}
      </Text>
      {expanded === undefined ? null : (
        <Ionicons
          accessibilityElementsHidden
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={palette.primary}
        />
      )}
    </Pressable>
  );
}

export function NetPayWorkflowChoice<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const numeric = options.length > 4;
  const wrapNumbers = numeric && (width < 370 || fontScale > 1.2);
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: SPACING.xxs,
        }}
      >
        {options.map((option) => (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            aria-checked={value === option.value}
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{
              checked: value === option.value,
              selected: value === option.value,
              disabled,
            }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: numeric ? (wrapNumbers ? "30%" : 44) : "40%",
              minWidth: CONTROL_HEIGHT.compact,
              minHeight: CONTROL_HEIGHT.compact,
              paddingHorizontal: SPACING.xxs,
              paddingVertical: SPACING.xs,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: RADII.control,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: value === option.value ? palette.primary : "transparent",
              backgroundColor: value === option.value ? palette.primarySoft : "transparent",
              opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                color: value === option.value ? palette.primary : palette.textSecondary,
                ...TYPOGRAPHY.label,
                textAlign: "center",
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function NetPayWorkflowSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
  compact = false,
  separator = false,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly searchable?: boolean;
  readonly compact?: boolean;
  readonly separator?: boolean;
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) =>
    option.label.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")),
  );
  const renderOptions = (dismiss: () => void) => (
    <>
      {searchable ? (
        <Field
          label={`${label} suchen`}
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
          placeholder="Name oder Region"
          autoCapitalize="none"
          autoCorrect={false}
          {...(compact
            ? {
                returnKeyType: "done" as const,
                submitBehavior: "blurAndSubmit" as const,
                enablesReturnKeyAutomatically: false,
                onSubmitEditing: Keyboard.dismiss,
              }
            : {})}
        />
      ) : null}
      {visibleOptions.length === 0 ? (
        <NetPayWorkflowText>Keine passende Kasse gefunden.</NetPayWorkflowText>
      ) : null}
      {visibleOptions.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          aria-checked={value === option.value}
          accessibilityLabel={`${label}: ${option.label}`}
          accessibilityState={{
            checked: value === option.value,
            selected: value === option.value,
            disabled,
          }}
          disabled={disabled}
          onPress={() => {
            onChange(option.value);
            dismiss();
          }}
          style={({ pressed }) => ({
            minHeight: CONTROL_HEIGHT.compact,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm,
            flexDirection: "row",
            gap: SPACING.md,
            alignItems: "center",
            borderRadius: RADII.control,
            backgroundColor:
              value === option.value
                ? compact
                  ? palette.surfaceMuted
                  : palette.primarySoft
                : "transparent",
            opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.body }}
          >
            {option.label}
          </Text>
          {value === option.value ? (
            <Ionicons
              accessibilityElementsHidden
              name="checkmark"
              size={18}
              color={compact ? palette.text : palette.primary}
            />
          ) : null}
        </Pressable>
      ))}
    </>
  );
  return (
    <View
      style={{
        gap: compact ? 0 : SPACING.sm,
        borderTopWidth: compact && separator ? 1 : 0,
        borderTopColor: palette.separator,
      }}
    >
      {compact ? null : (
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
        >
          {label}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} auswählen${selected ? `: ${selected.label}` : ""}`}
        accessibilityHint={compact ? "Öffnet die Auswahl in einem Dialog." : undefined}
        accessibilityState={compact ? { disabled } : { expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          if (compact) Keyboard.dismiss();
          if (compact && Platform.OS === "ios" && !searchable && options.length <= 7) {
            ActionSheetIOS.showActionSheetWithOptions(
              {
                title: label,
                message: selected ? `Aktuell: ${selected.label}` : undefined,
                options: [...options.map((option) => option.label), "Abbrechen"],
                cancelButtonIndex: options.length,
                tintColor: palette.text,
                cancelButtonTintColor: palette.text,
                userInterfaceStyle: palette.dark ? "dark" : "light",
              },
              (index) => {
                const option = options[index];
                if (option) onChange(option.value);
              },
            );
            return;
          }
          setQuery("");
          setExpanded(!expanded);
        }}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          paddingHorizontal: compact ? SPACING.lg : SPACING.md,
          paddingVertical: compact ? SPACING.lg : 10,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          borderWidth: compact ? 0 : 1,
          borderColor: palette.border,
          borderRadius: RADII.control,
          borderCurve: "continuous",
          backgroundColor: compact ? "transparent" : palette.surfaceRaised,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, gap: SPACING.xs }}>
          {compact ? (
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{label}</Text>
          ) : null}
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              color: selected ? palette.text : palette.textMuted,
              ...TYPOGRAPHY.body,
            }}
          >
            {selected?.label ?? "Bitte auswählen"}
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          name={compact ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={palette.textMuted}
        />
      </Pressable>
      {expanded && compact ? (
        <SelectionSheet
          title={label}
          visible
          disabled={disabled}
          onClose={() => setExpanded(false)}
          keyboardAware={searchable}
        >
          {(dismiss) => (
            <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>{renderOptions(dismiss)}</View>
          )}
        </SelectionSheet>
      ) : expanded ? (
        renderOptions(() => setExpanded(false))
      ) : null}
    </View>
  );
}
