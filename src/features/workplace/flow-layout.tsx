import { RADII, SPACING, SCREEN_LAYOUT } from "@/theme/tokens";
import { Fragment, useState, type ComponentProps, type ReactNode } from "react";
import { nativeScrollEdge } from "@/ui/native-scroll-edge";
import { GlassBackButton } from "@/ui/glass-back-button";
import { SurfaceCard, CardSeparator } from "@/ui/design-system";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/ui/text";
import Icon from "@/ui/icon";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { SHIFT_COLOR_PAIRS } from "@/theme/shift-colors";
import { calendarChipPalette } from "@/theme/color-contrast";

export function Headline({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="header" style={{ ...TYPOGRAPHY.highlightValue, color: p.text }}>
      {children}
    </Text>
  );
}
export function LinkAction({
  label,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: ComponentProps<typeof Icon>["name"];
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: SPACING.sm }}
    >
      {icon && <Icon name={icon} size={18} color={p.primary} />}
      <Text
        style={{
          ...TYPOGRAPHY.small,
          color: p.dark ? SHIFT_COLOR_PAIRS[4].soft : p.primaryAction,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
type PageProps = {
  title: string;
  onBack: () => void;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  pageKey: string;
  busy?: boolean;
};
export function FlowPage(props: PageProps) {
  const Provider = nativeScrollEdge?.ScrollEdgeEffectProvider ?? Fragment;
  return (
    <Provider>
      <PageBody {...props} />
    </Provider>
  );
}
function PageBody({ title, onBack, aside, footer, children, pageKey, busy = false }: PageProps) {
  const p = usePalette(),
    safe = useSafeAreaInsets();
  const scrollRef = nativeScrollEdge?.useScrollEdgeEffectRef();
  const [top, setTop] = useState(safe.top + 52),
    [bottom, setBottom] = useState(safe.bottom + 60);
  const Edge = nativeScrollEdge?.ScrollEdgeEffect;
  const header = (
    <View
      pointerEvents="box-none"
      onLayout={(e) => setTop(e.nativeEvent.layout.height)}
      style={{ paddingTop: safe.top, paddingHorizontal: SCREEN_LAYOUT.horizontalPadding }}
    >
      <View
        style={{
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <GlassBackButton label="Zurück" disabled={busy} onPress={onBack} />
        <Text style={{ ...TYPOGRAPHY.bodyStrong, color: p.text }}>{title}</Text>
        <View style={{ minWidth: 44 }}>{aside}</View>
      </View>
    </View>
  );
  const actions = (
    <View
      pointerEvents="box-none"
      onLayout={(e) => setBottom(e.nativeEvent.layout.height)}
      style={{
        paddingTop: SPACING.sm,
        paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
        paddingBottom: Math.max(SPACING.md, safe.bottom),
      }}
    >
      {footer}
    </View>
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: p.groupedBackground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {!Edge && header}
      <ScrollView
        key={pageKey}
        ref={scrollRef}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={{ top: Edge ? top : 0, bottom: Edge ? bottom : 0 }}
        contentContainerStyle={{
          paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
          paddingTop: (Edge ? top : 0) + SPACING.lg,
          paddingBottom: (Edge ? bottom : 0) + SPACING.xl,
          gap: SPACING.md,
        }}
      >
        {children}
      </ScrollView>
      {Edge ? (
        <>
          <Edge
            edge="top"
            effect="soft"
            pointerEvents="box-none"
            style={{ position: "absolute", top: 0, left: 0, right: 0 }}
          >
            {header}
          </Edge>
          <Edge
            edge="bottom"
            effect="soft"
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          >
            {actions}
          </Edge>
        </>
      ) : (
        actions
      )}
    </KeyboardAvoidingView>
  );
}
export function Choices({
  options,
  value,
  onChange,
}: {
  options: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
}) {
  const p = usePalette();
  return (
    <SurfaceCard>
      <View accessibilityRole="radiogroup">
        {Object.entries(options).map(([key, label], index) => {
          const selected = value === key;
          return (
            <Fragment key={key}>
              {index > 0 && <CardSeparator />}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onChange(key)}
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACING.md,
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.md,
                  backgroundColor: selected ? p.selectionActiveSurface : p.surface,
                }}
              >
                <Icon
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? p.primaryAction : p.textMuted}
                />
                <Text style={{ flex: 1, ...TYPOGRAPHY.compact, color: p.text }}>{label}</Text>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
    </SurfaceCard>
  );
}
export function Progress({ step, label }: { step: number; label: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 8, marginBottom: 8 }}>
      <Text style={{ ...TYPOGRAPHY.label, color: p.textMuted }}>
        Thema {step} von 6 · {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {Array.from({ length: 6 }, (_, n) => (
          <View
            key={n}
            style={{
              height: 4,
              borderRadius: RADII.pill,
              flex: 1,
              backgroundColor: n < step ? p.primaryAction : p.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}
export function Welcome() {
  const p = usePalette();
  const days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    shifts = ["F", "F", "S", "N", "–", "frei", "frei"];
  return (
    <>
      <Image
        accessible
        accessibilityLabel="LUNA Shift"
        resizeMode="contain"
        source={
          p.dark
            ? require("../../../assets/brand/lunashift/logo-horizontal-dark.png")
            : require("../../../assets/brand/lunashift/logo-horizontal-light.png")
        }
        style={{ width: 140, height: 48, marginVertical: 10 }}
      />
      <Headline>Welche Regeln gelten bei euch im Betrieb?</Headline>
      <Text style={{ ...TYPOGRAPHY.body, color: p.textMuted }}>
        LUNA prüft deinen Dienstplan nach Gesetz und Tarif. Hier kannst du ergänzen, welche Regeln
        in deiner Einrichtung gelten und wie deine Dienste üblicherweise geplant werden.
      </Text>
      <View
        style={{
          padding: 16,
          backgroundColor: p.surface,
          borderRadius: RADII.control,
          gap: 14,
          marginTop: 12,
        }}
      >
        <Text style={{ ...TYPOGRAPHY.bodyStrong, color: p.text }}>
          <Icon name="calendar-outline" size={15} /> Eine Beispielwoche
        </Text>
        <View style={{ flexDirection: "row", gap: 3 }}>
          {days.map((day, n) => {
            const colors = calendarChipPalette(
              SHIFT_COLOR_PAIRS[[4, 4, 2, 8, 7, 0, 0][n]].main,
              p.dark,
              true,
            );
            return (
              <View key={day} style={{ flex: 1, alignItems: "stretch", gap: 5 }}>
                <Text style={{ ...TYPOGRAPHY.caption, color: p.textMuted, textAlign: "center" }}>
                  {day}
                </Text>
                <Text
                  style={{
                    ...TYPOGRAPHY.label,
                    color: colors.onDetail,
                    backgroundColor: colors.detail,
                    paddingVertical: 6,
                    textAlign: "center",
                    borderRadius: RADII.small,
                    overflow: "hidden",
                  }}
                >
                  {shifts[n]}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
      <Text style={{ ...TYPOGRAPHY.small, color: p.textMuted }}>
        Sechs kurze Themen. Was du gerade nicht weißt, kannst du später unter „Mehr“ ergänzen.
      </Text>
    </>
  );
}
