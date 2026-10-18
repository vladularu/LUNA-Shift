import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { usePrivateCloud } from "./private-cloud-context";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { SectionHeader } from "@/ui/design-system";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { ScreenScrollView } from "@/ui/screen-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { userFacingErrorMessage } from "@/domain/errors";

export function PrivateCloudScreen() {
  const palette = usePalette();
  const { user, status, runtime, ready, initializationError } = usePrivateCloud();
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const accountId = user?.id;
  const selection = status.phase === "setup" || status.phase === "conflict";
  const disabled = busy || status.phase === "syncing" || !ready;
  useEffect(() => {
    setNotice(null);
  }, [accountId]);
  async function run(action: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(
        userFacingErrorMessage(
          error,
          "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
        ),
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function confirm(title: string, message: string, action: () => Promise<unknown>) {
    if (!accountId) return;
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Fortfahren",
        onPress: () => {
          if (runtime.isCurrentAccount(accountId)) void run(action);
        },
      },
    ]);
  }
  const body = { ...TYPOGRAPHY.body, color: palette.textSecondary };
  if (ready && (!user || (!selection && !busy && status.phase !== "syncing" && !notice)))
    return <Redirect href="/account" />;
  return (
    <BackFooterLayout onPress={() => router.back()}>
      {(bottom) => (
        <>
          <Stack.Screen options={{ title: "Daten auswählen" }} />
          <ScreenScrollView contentContainerStyle={{ paddingBottom: bottom, gap: SPACING.lg }}>
            {notice || initializationError ? (
              <Text accessibilityRole="alert" style={{ ...body, color: palette.danger }}>
                {notice ?? initializationError}
              </Text>
            ) : null}
            {!ready || status.phase === "syncing" ? (
              <Text style={body}>{ready ? "Wird abgeglichen …" : "Wird geladen …"}</Text>
            ) : user ? (
              <>
                {selection ? (
                  <View style={{ gap: SPACING.md }}>
                    <SectionHeader title="Welche Daten möchtest du behalten?" />
                    <Text style={body}>
                      {status.phase === "setup"
                        ? "Dieses Gerät war mit einem anderen Konto verbunden."
                        : "Gerät und Cloud unterscheiden sich."}
                    </Text>
                    {status.hasCloudData ? (
                      <PrimaryButton
                        disabled={disabled}
                        onPress={() =>
                          confirm(
                            "Cloud-Daten verwenden?",
                            `${status.phase === "setup" || status.requiresFullChoice ? "Der Cloud-Stand ersetzt diesen Gerätestand" : "Bei unterschiedlichen Angaben werden die Cloud-Daten verwendet"}. Konto: ${user.email ?? user.displayName}.`,
                            () => runtime.synchronize("cloud"),
                          )
                        }
                      >
                        Daten aus der Cloud
                      </PrimaryButton>
                    ) : null}
                    <SecondaryButton
                      disabled={disabled}
                      onPress={() =>
                        confirm(
                          "Gerätedaten verwenden?",
                          `${status.hasCloudData ? (status.phase === "setup" || status.requiresFullChoice ? "Dieser Gerätestand ersetzt die Cloud-Daten" : "Bei unterschiedlichen Angaben werden die Gerätedaten verwendet") : "Dieser Gerätestand wird in deiner Cloud gesichert"}. Konto: ${user.email ?? user.displayName}. Die Daten werden auf deine Geräte übertragen.`,
                          () => runtime.synchronize("device"),
                        )
                      }
                    >
                      Daten dieses Geräts
                    </SecondaryButton>
                  </View>
                ) : null}
              </>
            ) : null}
          </ScreenScrollView>
        </>
      )}
    </BackFooterLayout>
  );
}
