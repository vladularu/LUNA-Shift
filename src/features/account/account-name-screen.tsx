import { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  useWindowDimensions,
  type TextInput as NativeTextInput,
} from "react-native";
import { router, Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { usePrivateCloud } from "@/features/private-cloud/private-cloud-context";
import { userFacingErrorMessage } from "@/domain/errors";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text, TextInput } from "@/ui/text";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { ScreenScrollView } from "@/ui/screen-layout";

export function AccountNameScreen() {
  const cloud = usePrivateCloud();
  // Keyed form discards edits immediately if the signed-in identity changes.
  return (
    <>
      <Stack.Screen options={{ title: "Name ändern" }} />
      {cloud.user ? (
        <NameForm key={cloud.user.id} accountId={cloud.user.id} />
      ) : (
        <Text>Bitte melde dich in deinem LUNA-Konto an.</Text>
      )}
    </>
  );
}

function NameForm({ accountId }: { readonly accountId: string }) {
  const cloud = usePrivateCloud();
  const palette = usePalette();
  const header = useHeaderHeight();
  const { fontScale } = useWindowDimensions();
  const parts = cloud.user?.displayName.trim().split(/\s+/u) ?? [];
  const [first, setFirst] = useState(cloud.user?.givenName ?? parts[0] ?? "");
  const [last, setLast] = useState(cloud.user?.familyName ?? parts.slice(1).join(" "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const lastInput = useRef<NativeTextInput>(null);
  async function save() {
    if (working.current || !cloud.runtime.isCurrentAccount(accountId)) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await cloud.saveName(accountId, first, last);
      if (cloud.runtime.isCurrentAccount(accountId)) {
        Keyboard.dismiss();
        router.back();
      }
    } catch (failure) {
      if (cloud.runtime.isCurrentAccount(accountId))
        setError(
          userFacingErrorMessage(
            failure,
            "Dein Name konnte nicht gespeichert werden. Bitte versuche es erneut.",
          ),
        );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function row(
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    isLast: boolean,
  ) {
    return (
      <View
        style={{
          padding: SPACING.md,
          flexDirection: fontScale >= 1.6 ? "column" : "row",
          alignItems: fontScale >= 1.6 ? "stretch" : "center",
          gap: SPACING.md,
        }}
      >
        <Text style={{ ...TYPOGRAPHY.body, color: palette.text, minWidth: 110 }}>{label}</Text>
        <TextInput
          ref={isLast ? lastInput : undefined}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          editable={!busy}
          maxLength={80}
          autoFocus={!isLast}
          autoCapitalize="words"
          autoCorrect={false}
          textContentType={isLast ? "familyName" : "givenName"}
          autoComplete={isLast ? "family-name" : "given-name"}
          returnKeyType={isLast ? "done" : "next"}
          onSubmitEditing={() => (isLast ? void save() : lastInput.current?.focus())}
          style={{
            ...TYPOGRAPHY.body,
            color: palette.text,
            flex: fontScale >= 1.6 ? undefined : 1,
            minHeight: 44,
            minWidth: 0,
          }}
        />
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={header}
    >
      <ScreenScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: SPACING.lg, paddingTop: SPACING.xl }}
      >
        <SurfaceCard>
          {row("Vorname", first, setFirst, false)}
          <CardSeparator />
          {row("Nachname", last, setLast, true)}
        </SurfaceCard>
        {error ? (
          <Text accessibilityRole="alert" style={{ ...TYPOGRAPHY.body, color: palette.danger }}>
            {error}
          </Text>
        ) : null}
        <PrimaryButton
          busy={busy}
          disabled={busy || !(first.trim() || last.trim())}
          onPress={() => void save()}
        >
          Fertig
        </PrimaryButton>
      </ScreenScrollView>
    </KeyboardAvoidingView>
  );
}
