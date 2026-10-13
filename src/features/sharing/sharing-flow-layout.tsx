import { useContext, type PropsWithChildren, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import Ionicons from "@/ui/icon";
import { ScreenScrollView } from "@/ui/screen-layout";
import { Text } from "@/ui/text";

export function SharingIconButton({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  readonly label: string;
  readonly icon: "add" | "close" | "chevron-back" | "share-outline";
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: MINIMUM_TOUCH_TARGET,
        height: MINIMUM_TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADII.pill,
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.border,
        opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={palette.text} />
    </Pressable>
  );
}

export function SharingFlowLayout({
  title,
  onBack,
  close = false,
  footer,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly onBack: () => void;
  readonly close?: boolean;
  readonly footer?: ReactNode;
}>) {
  const palette = usePalette();
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0, bottom: 0 };
  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <View
        style={{
          paddingTop: close ? SPACING.xl : insets.top + SPACING.sm,
          paddingHorizontal: SPACING.xl,
          paddingBottom: SPACING.xl,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
        }}
      >
        <SharingIconButton
          label={close ? "Einladung schließen" : "Zurück"}
          icon={close ? "close" : "chevron-back"}
          onPress={onBack}
        />
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.screenTitle, color: palette.text, flex: 1, textAlign: "center" }}
        >
          {title}
        </Text>
        <View style={{ width: MINIMUM_TOUCH_TARGET }} />
      </View>
      <ScreenScrollView
        surface="groupedBackground"
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {children}
      </ScreenScrollView>
      {footer ? (
        <View
          style={{
            paddingHorizontal: SPACING.xl,
            paddingTop: SPACING.md,
            paddingBottom: Math.max(insets.bottom, SPACING.lg),
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function SharingSelection({
  title,
  label,
  selected,
  disabled = false,
  onPress,
}: {
  readonly title: string;
  readonly label?: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <SurfaceCard>
      <RowButton
        title={title}
        accessibilityLabel={label ?? title}
        accessibilityState={{ selected, checked: selected }}
        disabled={disabled}
        onPress={onPress}
        trailing={
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: RADII.small,
              borderWidth: 2,
              borderColor: selected ? palette.primary : palette.textMuted,
              backgroundColor: selected ? palette.primary : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {selected ? <Ionicons name="checkmark" size={18} color={palette.onPrimary} /> : null}
          </View>
        }
      />
    </SurfaceCard>
  );
}

export function SharingPerson({ name }: { readonly name: string }) {
  const palette = usePalette();
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
  return (
    <View style={{ alignItems: "center", gap: SPACING.lg, paddingVertical: SPACING.lg }}>
      <View
        accessible={false}
        style={{
          width: 96,
          height: 96,
          borderRadius: RADII.pill,
          backgroundColor: palette.primary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ ...TYPOGRAPHY.hero, color: palette.onPrimary }}>{initials}</Text>
      </View>
      <SectionHeader title={name} />
    </View>
  );
}
