import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { ChevronRight, Smartphone } from "lucide-react-native";
import { usePrivateCloud } from "@/features/private-cloud/private-cloud-context";
import {
  createSharingAuthPort,
  isSharingAppleSignInAvailable,
} from "@/infrastructure/auth/sharing-auth";
import { userFacingErrorMessage } from "@/domain/errors";
import { useOnboardingPalette } from "@/theme/onboarding";
import { MOTION } from "@/theme/motion";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { FieldError } from "./onboarding-controls";
import { GoogleMark, SyncIllustration } from "./onboarding-start-art";
import { s } from "./onboarding-screen.styles";
import { OnboardingHeader } from "./onboarding-header";

export function OnboardingStart({
  testMode,
  reducedMotion,
  onBack,
  onFinish,
  saveError,
}: {
  readonly testMode: boolean;
  readonly reducedMotion: boolean;
  readonly onBack: () => void;
  readonly onFinish: () => Promise<void>;
  readonly saveError?: string;
}) {
  const p = useOnboardingPalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const cloud = usePrivateCloud();
  const auth = useMemo(() => createSharingAuthPort(), []);
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(null);
  const [hero] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [sheet] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [entered, setEntered] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) {
      hero.setValue(1);
      sheet.setValue(1);
      setEntered(true);
      return;
    }
    if (entered) return;
    const timing = { toValue: 1, useNativeDriver: true, easing: MOTION.easing.navigation };
    const entrance = Animated.sequence([
      Animated.timing(hero, { ...timing, duration: MOTION.duration.normal }),
      Animated.timing(sheet, { ...timing, duration: MOTION.duration.deliberate }),
    ]);
    entrance.start(({ finished }) => {
      if (finished) setEntered(true);
    });
    return () => entrance.stop();
  }, [entered, hero, reducedMotion, sheet]);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const working = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void isSharingAppleSignInAvailable().then((value) => {
      if (active) setAppleAvailable(value);
    });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  async function start(provider?: "apple" | "google") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setAuthError(undefined);
    try {
      if (provider && !cloud.user) {
        const user = provider === "apple" ? await auth.signInApple() : await auth.signInGoogle();
        if (!user || !mounted.current) return;
        await cloud.refreshAccount();
      }
      if (mounted.current) await onFinish();
    } catch (error) {
      if (mounted.current)
        setAuthError(
          userFacingErrorMessage(
            error,
            "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
          ),
        );
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const existing = !!cloud.user && !testMode;
  const unavailable =
    cloud.initializationError ||
    (!auth.isConfigured ? "Dein LUNA-Konto ist gerade nicht erreichbar." : undefined);
  const authDisabled = busy || !cloud.ready || !!unavailable;
  const buttonHeight = Math.max(52, Math.ceil(24 * fontScale) + SPACING.xl);
  const divider = <View style={[styles.divider, { backgroundColor: p.control }]} />;
  return (
    <View
      style={[
        s.safe,
        { backgroundColor: p.canvas, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <OnboardingHeader
        onBack={onBack}
        busy={busy}
        onClose={testMode ? () => void start() : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        <Animated.View
          style={[
            styles.hero,
            {
              opacity: reducedMotion ? 1 : hero,
              transform: [
                {
                  scale: reducedMotion
                    ? 1
                    : hero.interpolate({
                        inputRange: [0, 1],
                        outputRange: [MOTION.scale.enter, 1],
                      }),
                },
              ],
            },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SyncIllustration />
        </Animated.View>
        <Animated.View
          testID="onboarding-start-sheet"
          pointerEvents={entered || reducedMotion ? "auto" : "none"}
          accessibilityElementsHidden={!entered && !reducedMotion}
          importantForAccessibility={entered || reducedMotion ? "auto" : "no-hide-descendants"}
          style={[
            styles.sheet,
            {
              opacity: reducedMotion ? 1 : sheet,
              transform: [
                {
                  translateY: reducedMotion
                    ? 0
                    : sheet.interpolate({ inputRange: [0, 1], outputRange: [SPACING.xl, 0] }),
                },
              ],
            },
            {
              backgroundColor: p.surface,
              borderColor: p.control,
              paddingBottom: Math.max(insets.bottom, SPACING.xl),
            },
          ]}
        >
          <Text accessibilityRole="header" style={[s.title, { color: p.text }]}>
            Mit Konto starten
          </Text>
          <Text style={[s.body, { color: p.muted, marginBottom: SPACING.sm }]}>
            {cloud.user
              ? "Du bist bereits mit deinem LUNA-Konto angemeldet."
              : testMode
                ? "Apple und Google melden dich auch im Test mit deinem echten Konto an. Deine Testangaben werden verworfen."
                : "Melde dich an, um deine Daten zu synchronisieren."}
          </Text>
          {!existing && (
            <>
              {appleAvailable === null && Platform.OS === "ios" && (
                <View
                  testID="onboarding-apple-placeholder"
                  style={{ height: buttonHeight }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              )}
              {appleAvailable && (
                <View
                  pointerEvents={authDisabled ? "none" : "auto"}
                  style={{ opacity: authDisabled ? 0.5 : 1 }}
                >
                  <AppleAuthenticationButton
                    buttonType={AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={
                      p.dark
                        ? AppleAuthenticationButtonStyle.WHITE
                        : AppleAuthenticationButtonStyle.BLACK
                    }
                    cornerRadius={RADII.control}
                    style={{ width: "100%", height: buttonHeight }}
                    accessibilityState={{ disabled: authDisabled }}
                    onPress={() => {
                      if (!authDisabled) void start("apple");
                    }}
                  />
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={authDisabled}
                onPress={() => void start("google")}
                style={[
                  styles.provider,
                  {
                    minHeight: buttonHeight,
                    backgroundColor: p.rose,
                    borderColor: p.control,
                    opacity: authDisabled ? 0.5 : 1,
                  },
                ]}
              >
                <GoogleMark />
                <Text style={[s.buttonText, styles.shrink, { color: p.text }]}>
                  Mit Google fortfahren
                </Text>
              </Pressable>
              <View style={styles.or}>
                {divider}
                <Text style={[s.caption, { color: p.muted }]}>oder</Text>
                {divider}
              </View>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void start()}
            style={styles.guest}
          >
            <Smartphone accessible={false} size={26} color={p.text} />
            <Text style={[s.buttonText, { color: p.text, flex: 1 }]}>
              {existing ? "Mit diesem Konto fortfahren" : "Als Gast starten"}
            </Text>
            <ChevronRight accessible={false} size={18} color={p.muted} />
          </Pressable>
          {(busy || (!existing && !cloud.ready && !unavailable)) && (
            <ActivityIndicator
              accessibilityLabel={busy ? "Einrichtung läuft" : "Konto wird geladen"}
              color={p.muted}
            />
          )}
          <FieldError message={authError || saveError || unavailable || undefined} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  hero: { flexGrow: 1, minHeight: 160, justifyContent: "center", alignItems: "center" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  provider: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderWidth: 1,
    borderRadius: RADII.control,
  },
  shrink: { flexShrink: 1 },
  or: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  guest: {
    minHeight: MINIMUM_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
});
