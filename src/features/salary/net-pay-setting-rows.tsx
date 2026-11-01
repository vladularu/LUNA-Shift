import { useRef, useState, type ComponentProps, type PropsWithChildren } from "react";
import { Keyboard, Pressable, View, useWindowDimensions } from "react-native";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, RADII, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Field } from "@/ui/form-controls";
import { Text, TextInput } from "@/ui/text";
import { NetPayCheck } from "./net-pay-controls";
import { NetPaySheet } from "./net-pay-sheet";
import {
  NetPayWorkflowChoice,
  NetPayWorkflowSelect,
  NetPayWorkflowText,
} from "./net-pay-workflow-controls";

export function NetPaySettingChoice<T extends string | number | boolean>({
  compact,
  separator = true,
  ...props
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly compact: boolean;
  readonly separator?: boolean;
}) {
  if (!compact) return <NetPayWorkflowChoice {...props} />;
  return (
    <NetPayWorkflowSelect
      compact
      separator={separator}
      label={props.label}
      value={props.value === null ? null : String(props.value)}
      disabled={props.disabled}
      options={props.options.map((option) => ({
        value: String(option.value),
        label: option.label,
      }))}
      onChange={(value) => {
        const option = props.options.find((option) => String(option.value) === value);
        if (option) props.onChange(option.value);
      }}
    />
  );
}

export function NetPaySettingField({
  compact,
  title,
  caption,
  separator = true,
  ...props
}: Omit<ComponentProps<typeof Field>, "inputRef"> & {
  readonly compact: boolean;
  readonly title?: string;
  readonly caption?: string;
  readonly separator?: boolean;
}) {
  const palette = usePalette();
  const input = useRef<TextInput>(null);
  const { width, fontScale } = useWindowDimensions();
  const stacked =
    fontScale > SELECTION_METRICS.stackFontScale || width < SELECTION_METRICS.narrowWidth;
  if (!compact) return <Field {...props} />;
  const { label, error, style, ...inputProps } = props;
  return (
    <Pressable
      accessible={false}
      disabled={inputProps.editable === false}
      onPress={() => input.current?.focus()}
      style={{
        padding: SPACING.lg,
        borderTopWidth: separator ? 1 : 0,
        borderTopColor: palette.separator,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
        gap: SPACING.md,
        opacity: inputProps.editable === false ? 0.5 : 1,
      }}
    >
      <View style={{ flex: stacked ? undefined : 1, gap: SPACING.xs }}>
        <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>{title ?? label}</Text>
        {caption ? (
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{caption}</Text>
        ) : null}
      </View>
      <TextInput
        {...inputProps}
        ref={input}
        selectTextOnFocus
        returnKeyType="done"
        inputAccessoryViewButtonLabel="Fertig"
        submitBehavior="blurAndSubmit"
        onSubmitEditing={(event) => {
          inputProps.onSubmitEditing?.(event);
          Keyboard.dismiss();
        }}
        accessibilityLabel={inputProps.accessibilityLabel ?? `${label}${error ? ", ungültig" : ""}`}
        accessibilityHint={error ? `Fehler: ${error}` : inputProps.accessibilityHint}
        accessibilityLiveRegion={error ? "polite" : inputProps.accessibilityLiveRegion}
        aria-invalid={Boolean(error)}
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        placeholderTextColor={palette.textMuted}
        style={[
          {
            color: palette.text,
            ...TYPOGRAPHY.input,
            minHeight: CONTROL_HEIGHT.compact,
            minWidth: 96,
            maxWidth: stacked ? undefined : 132,
            padding: 0,
            textAlign: stacked ? "left" : "right",
          },
          style,
        ]}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: palette.danger, ...TYPOGRAPHY.footnote }}
        >
          {error}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function NetPaySettingGroup({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderColor: palette.separator,
        borderWidth: 1,
        borderRadius: RADII.card,
        borderCurve: "continuous",
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

export function NetPaySettingDetails({
  children,
  label,
  value,
  disabled,
  compact,
}: PropsWithChildren<{
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly compact: boolean;
}>) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  if (!compact) return children;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} bearbeiten: ${value}`}
        accessibilityHint="Öffnet die Angaben in einem Dialog."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          padding: SPACING.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, gap: SPACING.xs }}>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{label}</Text>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>{value}</Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          name="chevron-forward"
          size={18}
          color={palette.textMuted}
        />
      </Pressable>
      <NetPaySheet
        title={label}
        visible={expanded}
        busy={disabled}
        onClose={() => setExpanded(false)}
      >
        {children}
      </NetPaySheet>
    </View>
  );
}

export function NetPaySettingAmount({
  title,
  label,
  caption,
  value,
  onChangeText,
  disabled,
  compact,
}: {
  readonly title: string;
  readonly label: string;
  readonly caption: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly disabled: boolean;
  readonly compact: boolean;
}) {
  const palette = usePalette();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const { fontScale, width } = useWindowDimensions();
  const stacked =
    fontScale > SELECTION_METRICS.stackFontScale || width < SELECTION_METRICS.narrowWidth;
  const trimmed = value.trim();
  const amount = Number(trimmed.replace(",", "."));
  const formatted =
    /^\d+(?:[,.]\d{0,2})?$/.test(trimmed) && Number.isFinite(amount)
      ? amount.toLocaleString("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          useGrouping: false,
        })
      : value;
  if (!compact)
    return (
      <>
        <Field
          label={label}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          keyboardType="decimal-pad"
        />
        {caption ? <NetPayWorkflowText>{caption}</NetPayWorkflowText> : null}
      </>
    );
  return (
    <Pressable
      accessible={false}
      disabled={disabled}
      onPress={() => input.current?.focus()}
      style={{
        padding: SPACING.lg,
        borderTopWidth: 1,
        borderTopColor: palette.separator,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "stretch" : "center",
        gap: SPACING.sm,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: stacked ? undefined : 1, gap: SPACING.xs }}>
        <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>{title}</Text>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{caption}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xs }}>
          <TextInput
            ref={input}
            accessibilityLabel={label}
            accessibilityHint={`${caption} Betrag in Euro pro Monat.`}
            editable={!disabled}
            keyboardType="decimal-pad"
            returnKeyType="done"
            inputAccessoryViewButtonLabel="Fertig"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={Keyboard.dismiss}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            selectTextOnFocus
            value={focused ? value : formatted}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChangeText={onChangeText}
            style={{
              color: palette.text,
              ...TYPOGRAPHY.bodyStrong,
              minHeight: CONTROL_HEIGHT.compact,
              minWidth: 68,
              maxWidth: stacked ? undefined : 120,
              textAlign: "right",
              padding: 0,
            }}
          />
          <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>€</Text>
        </View>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>pro Monat</Text>
      </View>
    </Pressable>
  );
}

export function NetPaySettingCheck({
  label,
  checked,
  onChange,
  disabled,
  compact,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled: boolean;
  readonly compact: boolean;
}) {
  const palette = usePalette();
  if (!compact)
    return <NetPayCheck label={label} checked={checked} onChange={onChange} disabled={disabled} />;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: CONTROL_HEIGHT.regular,
        borderTopWidth: 1,
        borderTopColor: palette.separator,
        padding: SPACING.lg,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.md,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: RADII.small,
          borderWidth: 1.5,
          borderColor: palette.text,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? (
          <Ionicons accessibilityElementsHidden name="checkmark" size={18} color={palette.text} />
        ) : null}
      </View>
      <Text style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.body }}>{label}</Text>
    </Pressable>
  );
}
