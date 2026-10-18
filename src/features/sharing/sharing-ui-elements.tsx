import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { InlineNotice, SurfaceCard } from "@/ui/design-system";
import { Text } from "@/ui/text";
import { ScreenScrollView } from "@/ui/screen-layout";
import type { SharingController } from "./sharing-ui-contract";

export function SharingParagraph({ children }: { readonly children: string }) {
  const palette = usePalette();
  return (
    <Text
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      selectable
      style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}
    >
      {children}
    </Text>
  );
}
export function SharingUnavailableScreen() {
  return (
    <ScreenScrollView surface="groupedBackground">
      <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
        <SharingParagraph>Kalenderfreigaben sind noch nicht eingerichtet.</SharingParagraph>
        <SharingParagraph>Dein Kalender bleibt ohne Konto nutzbar.</SharingParagraph>
      </SurfaceCard>
    </ScreenScrollView>
  );
}
const DEFAULT_SHARING_ERROR = "Freigaben konnten nicht aktualisiert werden. Versuche es erneut.";

export function useSharingAction(controller: SharingController) {
  const locked = useRef(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState(DEFAULT_SHARING_ERROR);
  const busy = working || controller.busy;
  async function run(
    action: () => Promise<void>,
    message = DEFAULT_SHARING_ERROR,
  ): Promise<boolean> {
    if (locked.current || controller.busy) return false;
    locked.current = true;
    setWorking(true);
    setFailed(false);
    try {
      await action();
      return true;
    } catch {
      setFailureMessage(message);
      setFailed(true);
      return false;
    } finally {
      locked.current = false;
      setWorking(false);
    }
  }
  return {
    busy,
    failed: failed || controller.error,
    failureMessage: failed ? failureMessage : DEFAULT_SHARING_ERROR,
    run,
  };
}
export function SharingStatus({
  failed,
  busy,
  message = DEFAULT_SHARING_ERROR,
}: {
  readonly failed: boolean;
  readonly busy: boolean;
  readonly message?: string;
}) {
  return (
    <>
      {failed ? <InlineNotice tone="error" message={message} /> : null}
      {busy ? <ActivityIndicator accessibilityLabel="Wird bearbeitet" /> : null}
    </>
  );
}
export function SignInActions({
  controller,
  run,
  busy,
}: {
  readonly controller: Pick<SharingController, "appleAvailable" | "signIn">;
  readonly run: (action: () => Promise<void>, message?: string) => Promise<boolean>;
  readonly busy: boolean;
}) {
  const palette = usePalette();
  const options = [
    ...(controller.appleAvailable
      ? [{ provider: "apple" as const, title: "Mit Apple fortfahren", icon: "logo-apple" as const }]
      : []),
    { provider: "google" as const, title: "Mit Google fortfahren", icon: "logo-google" as const },
  ];
  return (
    <View style={{ gap: SPACING.md }}>
      {options.map((option) => (
        <Pressable
          key={option.provider}
          accessibilityRole="button"
          accessibilityLabel={option.title}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() =>
            void run(
              () => controller.signIn(option.provider),
              "Anmeldung fehlgeschlagen. Versuche es erneut.",
            )
          }
          style={({ pressed }) => ({
            minHeight: CONTROL_HEIGHT.large,
            gap: SPACING.md,
            padding: SPACING.md,
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            borderWidth: 1,
            borderColor: palette.border,
            borderCurve: CORNER_CURVE,
            borderRadius: RADII.control,
            backgroundColor: option.provider === "apple" ? palette.primary : palette.surface,
            opacity: busy ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Ionicons
            accessible={false}
            accessibilityElementsHidden
            name={option.icon}
            size={22}
            color={option.provider === "apple" ? palette.onPrimary : palette.text}
          />
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              ...TYPOGRAPHY.button,
              color: option.provider === "apple" ? palette.onPrimary : palette.text,
              flexShrink: 1,
            }}
          >
            {option.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function updateLabel(value: string | null): string {
  if (!value) return "Noch nicht aktualisiert";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Letzter Stand unbekannt";
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
