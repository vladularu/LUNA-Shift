import { useRef, type RefObject } from "react";
import { Pressable, StyleSheet, View, type TextInputProps } from "react-native";
import { Pencil } from "lucide-react-native";

import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { Text, TextInput } from "@/ui/text";

type ProfileValueFieldProps = Pick<
  TextInputProps,
  | "autoCapitalize"
  | "editable"
  | "keyboardType"
  | "maxLength"
  | "onChangeText"
  | "placeholder"
  | "selectTextOnFocus"
  | "value"
> & {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly unit?: string;
  readonly error?: string | null;
  readonly inputRef?: RefObject<TextInput | null>;
};

export function ProfileValueField({
  label,
  accessibilityLabel,
  unit,
  error,
  inputRef,
  editable,
  ...inputProps
}: ProfileValueFieldProps) {
  const palette = usePalette();
  const localInputRef = useRef<TextInput>(null);
  const fieldRef = inputRef ?? localInputRef;

  return (
    <SurfaceCard>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.primaryAction, opacity: 0.1 }]}
      />
      <Pressable
        accessible={false}
        disabled={editable === false}
        onPress={() => fieldRef.current?.focus()}
        style={styles.field}
      >
        <View style={styles.content}>
          <Text
            accessible={false}
            style={{ ...TYPOGRAPHY.compactCaption, color: palette.textMuted }}
          >
            {label}
          </Text>
          <View style={styles.value}>
            <TextInput
              ref={fieldRef}
              {...inputProps}
              accessibilityLabel={accessibilityLabel}
              editable={editable}
              placeholderTextColor={palette.textMuted}
              style={[
                styles.input,
                { ...TYPOGRAPHY.highlightValue, color: palette.text },
                unit ? styles.numberInput : styles.nameInput,
              ]}
            />
            {unit ? (
              <Text accessible={false} style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
                {unit}
              </Text>
            ) : null}
          </View>
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ ...TYPOGRAPHY.footnote, color: palette.danger }}
            >
              {error}
            </Text>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        >
          <Pencil size={17} strokeWidth={1.8} color={palette.primaryAction} />
        </View>
      </Pressable>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: SPACING.sm,
  },
  input: {
    minHeight: 44,
    padding: 0,
  },
  numberInput: {
    minWidth: 44,
    flexShrink: 1,
    fontVariant: ["tabular-nums"],
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
  },
});
