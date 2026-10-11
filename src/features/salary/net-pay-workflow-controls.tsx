import { useState, type ComponentProps, type PropsWithChildren } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { RowButton } from "@/ui/design-system";
import { Field, PrimaryButton } from "@/ui/form-controls";

export function NetPayWorkflowText({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <Text
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
    >
      {children}
    </Text>
  );
}

export function NetPayWorkflowField(props: ComponentProps<typeof Field>) {
  return <Field {...props} />;
}

export function NetPayWorkflowAmount({
  title,
  value,
  caption,
  prefix,
  large = false,
}: {
  readonly title: string;
  readonly value: string;
  readonly caption?: string;
  readonly prefix?: string;
  readonly large?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
      >
        {title}
      </Text>
      <View
        accessible
        accessibilityLabel={`${title}: ${prefix ? `${prefix} ` : ""}${value}`}
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: SPACING.xs }}
      >
        {prefix ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: palette.textMuted, ...TYPOGRAPHY.value }}
          >
            {prefix}
          </Text>
        ) : null}
        <Text
          selectable
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            color: palette.text,
            ...(large ? TYPOGRAPHY.hero : TYPOGRAPHY.highlightCount),
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      </View>
      {caption ? <NetPayWorkflowText>{caption}</NetPayWorkflowText> : null}
    </View>
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
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly searchable?: boolean;
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) =>
    option.label.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")),
  );
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.label }}
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} auswählen${selected ? `: ${selected.label}` : ""}`}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setExpanded(!expanded);
        }}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          paddingHorizontal: SPACING.md,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: RADII.control,
          borderCurve: "continuous",
          backgroundColor: palette.surfaceRaised,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            flex: 1,
            color: selected ? palette.text : palette.textMuted,
            ...TYPOGRAPHY.body,
          }}
        >
          {selected?.label ?? "Bitte auswählen"}
        </Text>
        <Ionicons
          accessibilityElementsHidden
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={palette.textMuted}
        />
      </Pressable>
      {expanded && searchable ? (
        <Field
          label={`${label} suchen`}
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
          placeholder="Name oder Region"
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      {expanded && visibleOptions.length === 0 ? (
        <NetPayWorkflowText>Keine passende Kasse gefunden.</NetPayWorkflowText>
      ) : null}
      {expanded
        ? visibleOptions.map((option) => (
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
                setExpanded(false);
              }}
              style={({ pressed }) => ({
                minHeight: CONTROL_HEIGHT.compact,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                borderRadius: RADII.control,
                backgroundColor: value === option.value ? palette.primarySoft : "transparent",
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
                  color={palette.primary}
                />
              ) : null}
            </Pressable>
          ))
        : null}
    </View>
  );
}

export function NetPayWorkflowTabs({
  value,
  onChange,
  disabled,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly disabled: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: SPACING.xxs }}>
      {["Steuern", "Familie", "Versicherung"].map((label, index) => (
        <Pressable
          key={label}
          accessibilityRole="tab"
          accessibilityLabel={label}
          aria-selected={value === index}
          accessibilityState={{ selected: value === index, disabled }}
          onPress={() => onChange(index)}
          disabled={disabled}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            paddingHorizontal: SPACING.xs,
            paddingVertical: SPACING.sm,
            borderRadius: RADII.control,
            borderBottomWidth: 2,
            borderBottomColor: value === index ? palette.accent : "transparent",
            backgroundColor: value === index ? palette.surfaceMuted : palette.surfaceRaised,
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              color: value === index ? palette.accent : palette.textMuted,
              ...TYPOGRAPHY.label,
              textAlign: "center",
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function NetPayWorkflowRow({
  title,
  subtitle,
  onPress,
  disabled = false,
  embedded = false,
  expanded,
  icon,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly embedded?: boolean;
  readonly expanded?: boolean;
  readonly icon?: ComponentProps<typeof Ionicons>["name"];
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        backgroundColor: embedded ? "transparent" : palette.surface,
        borderRadius: embedded ? 0 : RADII.large,
        overflow: "hidden",
      }}
    >
      <RowButton
        title={title}
        subtitle={subtitle}
        accessibilityLabel={`${title} · ${subtitle}`}
        accessibilityState={expanded === undefined ? undefined : { expanded }}
        disabled={disabled}
        onPress={onPress}
        leading={
          icon ? (
            <Ionicons accessibilityElementsHidden name={icon} size={24} color={palette.primary} />
          ) : undefined
        }
        trailing={
          <Ionicons
            accessibilityElementsHidden
            name={
              expanded === undefined ? "chevron-forward" : expanded ? "chevron-up" : "chevron-down"
            }
            size={18}
            color={palette.textMuted}
          />
        }
      />
    </View>
  );
}
