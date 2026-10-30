import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  View,
} from "react-native";
import { Pencil } from "lucide-react-native";
import { router, Stack } from "expo-router";
import {
  createSharingAuthPort,
  isSharingAppleSignInAvailable,
} from "@/infrastructure/auth/sharing-auth";
import { usePrivateCloud } from "@/features/private-cloud/private-cloud-context";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { userFacingErrorMessage } from "@/domain/errors";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { ScreenScrollView, TabScreenHeader } from "@/ui/screen-layout";
import { CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { SharingIconButton } from "@/features/sharing/sharing-flow-layout";
import { SignInActions } from "@/features/sharing/sharing-ui-elements";
import { AccountCloudStatus, AccountSyncNotice } from "./account-status";

export function AccountScreen() {
  const palette = usePalette();
  const cloud = usePrivateCloud();
  const controller = useSharingUiController();
  const auth = useMemo(() => createSharingAuthPort(), []);
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const account = cloud.user;
  const photoMenu = useRef({ open: false, version: 0 });
  useEffect(() => {
    const menu = photoMenu.current;
    return () => {
      menu.version++;
      if (menu.open && Platform.OS === "ios") ActionSheetIOS.dismissActionSheet();
      menu.open = false;
    };
  }, [account?.id]);
  useEffect(() => {
    let active = true;
    void isSharingAppleSignInAvailable().then(
      (value) => {
        if (active) setApple(value);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setError(null);
  }, [account?.id]);
  async function run(action: () => Promise<unknown>) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(
        userFacingErrorMessage(
          failure,
          "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
        ),
      );
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function confirm(deleting: boolean) {
    if (!account) return;
    const accountId = account.id;
    Alert.alert(
      deleting ? "LUNA-Konto dauerhaft löschen?" : "Von LUNA abmelden?",
      deleting
        ? "Dein Konto, alle privaten Cloud-Sicherungen und Kalenderfreigaben werden dauerhaft gelöscht. Deine eigenen Daten bleiben auf diesem Gerät."
        : "Cloud-Abgleich und Teilen werden auf diesem Gerät beendet. Deine eigenen Daten bleiben erhalten.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: deleting ? "Konto löschen" : "Abmelden",
          style: "destructive",
          onPress: () => {
            if (!cloud.runtime.isCurrentAccount(accountId)) return;
            void run(async () => {
              if (deleting) {
                if (!controller?.accountDeletionAvailable) return;
                await controller.deleteAccount();
              } else if (controller?.status === "signedIn") await controller.signOut();
              else await auth.signOut();
              await cloud.refreshAccount();
            });
          },
        },
      ],
    );
  }
  const body = { ...TYPOGRAPHY.body, color: palette.textSecondary };
  const disabled = busy || !!controller?.busy || !!cloud.photo?.busy;
  const deletionDisabled =
    disabled || !controller?.accountDeletionAvailable || controller.status !== "signedIn";
  function openPhotoMenu() {
    const photo = cloud.photo;
    const menu = photoMenu.current;
    if (!account || !photo?.ready || disabled || menu.open) return;
    const accountId = account.id;
    const version = menu.version;
    const { uri, choose, remove } = photo;
    const options = ["Foto auswählen", ...(photo.uri ? ["Foto entfernen"] : []), "Abbrechen"];
    const cancelButtonIndex = options.length - 1;
    menu.open = true;
    function select(index: number) {
      if (version !== menu.version) return;
      menu.open = false;
      if (!cloud.runtime.isCurrentAccount(accountId)) return;
      if (index === 0) void choose();
      else if (uri && index === 1) void remove();
    }
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex: photo.uri ? 1 : undefined,
        },
        select,
      );
    } else {
      Alert.alert(
        "Profilbild",
        undefined,
        options.map((text, index) => ({
          text,
          style: index === cancelButtonIndex ? "cancel" : index === 1 ? "destructive" : "default",
          onPress: () => select(index),
        })),
        {
          cancelable: true,
          onDismiss: () => {
            menu.open = false;
          },
        },
      );
    }
  }
  if (!account)
    return (
      <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
        <Stack.Screen options={{ headerShown: false }} />
        <TabScreenHeader
          title="Konto"
          surface="groupedBackground"
          accessory={
            <SharingIconButton label="Zurück" icon="chevron-back" onPress={() => router.back()} />
          }
        />
        <ScreenScrollView surface="groupedBackground">
          <Text style={body}>Anmelden und automatisch synchronisieren.</Text>
          {error || cloud.initializationError ? (
            <Text accessibilityRole="alert" style={{ ...body, color: palette.danger }}>
              {error ?? cloud.initializationError}
            </Text>
          ) : null}
          {!cloud.ready ? (
            <Text style={body}>Wird geladen …</Text>
          ) : !auth.isConfigured ? (
            <Text style={body}>Dein LUNA-Konto ist gerade nicht erreichbar.</Text>
          ) : (
            <SignInActions
              controller={{
                appleAvailable: apple,
                signIn: async (provider) => {
                  if (provider === "apple") await auth.signInApple();
                  else await auth.signInGoogle();
                  await cloud.refreshAccount();
                },
              }}
              run={run}
              busy={disabled}
            />
          )}
        </ScreenScrollView>
      </View>
    );
  return (
    <BackFooterLayout onPress={() => router.back()}>
      {(bottom) => (
        <>
          <Stack.Screen
            options={{
              title: "Konto",
              headerShown: true,
            }}
          />
          <ScreenScrollView contentContainerStyle={{ paddingBottom: bottom, gap: SPACING.lg }}>
            {error || cloud.initializationError ? (
              <Text accessibilityRole="alert" style={{ ...body, color: palette.danger }}>
                {error ?? cloud.initializationError}
              </Text>
            ) : null}
            {!cloud.ready ? (
              <Text style={body}>Dein Konto wird geladen …</Text>
            ) : !auth.isConfigured ? (
              <Text style={body}>Dein LUNA-Konto wird noch eingerichtet.</Text>
            ) : (
              <>
                <View
                  style={{ alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.lg }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      cloud.photo?.uri ? "Profilbild ändern" : "Profilbild auswählen"
                    }
                    accessibilityHint="Öffnet die Fotoaktionen."
                    accessibilityState={{
                      disabled: disabled || !cloud.photo?.ready,
                      busy: !!cloud.photo?.busy,
                    }}
                    disabled={disabled || !cloud.photo?.ready}
                    onPress={openPhotoMenu}
                    style={({ pressed }) => ({
                      width: 104,
                      height: 104,
                      borderRadius: RADII.pill,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: palette.primary,
                      opacity: pressed ? 0.75 : 1,
                      marginBottom: SPACING.sm,
                    })}
                  >
                    {cloud.photo?.uri ? (
                      <Image
                        source={{ uri: cloud.photo.uri }}
                        accessibilityLabel="Profilbild"
                        style={{ width: 104, height: 104, borderRadius: RADII.pill }}
                      />
                    ) : (
                      <Text style={{ ...TYPOGRAPHY.hero, color: palette.onPrimary }}>
                        {account.displayName
                          .trim()
                          .split(/\s+/u)
                          .filter(Boolean)
                          .map((part) => Array.from(part)[0])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join("")
                          .toLocaleUpperCase("de-DE")}
                      </Text>
                    )}
                    {cloud.photo ? (
                      <View
                        pointerEvents="none"
                        accessible={false}
                        style={{
                          position: "absolute",
                          right: -2,
                          bottom: -2,
                          width: 32,
                          height: 32,
                          borderRadius: RADII.pill,
                          borderWidth: 3,
                          borderColor: palette.groupedBackground,
                          backgroundColor: palette.surfaceMuted,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {cloud.photo.busy ? (
                          <ActivityIndicator size="small" color={palette.text} />
                        ) : (
                          <Pencil size={16} strokeWidth={2} color={palette.text} />
                        )}
                      </View>
                    ) : null}
                  </Pressable>
                  <Text
                    style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text, textAlign: "center" }}
                  >
                    {account.displayName}
                  </Text>
                  {account.email ? (
                    <Text selectable style={{ ...body, textAlign: "center" }}>
                      {account.email}
                    </Text>
                  ) : null}
                  {cloud.photo?.error ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ ...body, color: palette.danger, textAlign: "center" }}
                    >
                      {cloud.photo.error}
                    </Text>
                  ) : null}
                </View>
                <AccountSyncNotice />
                <SurfaceCard>
                  <RowButton
                    title="Name"
                    onPress={() => router.push("/account-name")}
                    disabled={disabled}
                  />
                  {account.email ? (
                    <>
                      <CardSeparator />
                      <RowButton title="E-Mail" subtitle={account.email} subtitleBelow />
                    </>
                  ) : null}
                </SurfaceCard>
                <PrimaryButton danger disabled={disabled} onPress={() => confirm(false)}>
                  Abmelden
                </PrimaryButton>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Konto löschen"
                  accessibilityState={{ disabled: deletionDisabled }}
                  disabled={deletionDisabled}
                  onPress={() => confirm(true)}
                  style={({ pressed }) => ({
                    minHeight: MINIMUM_TOUCH_TARGET,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: SPACING.lg,
                    opacity: deletionDisabled ? 0.45 : pressed ? 0.65 : 1,
                  })}
                >
                  <Text style={{ ...TYPOGRAPHY.body, color: palette.danger, textAlign: "center" }}>
                    Konto löschen
                  </Text>
                </Pressable>
                <View style={{ gap: SPACING.xs }}>
                  <AccountCloudStatus />
                </View>
              </>
            )}
          </ScreenScrollView>
        </>
      )}
    </BackFooterLayout>
  );
}
