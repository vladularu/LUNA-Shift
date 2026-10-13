import { useEffect, useState } from "react";
import { View } from "react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { Field, PrimaryButton } from "@/ui/form-controls";
import { LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { Text } from "@/ui/text";
import {
  SharingParagraph,
  SharingStatus,
  SharingUnavailableScreen,
  SignInActions,
  useSharingAction,
} from "./sharing-ui-elements";
import type { SharingController } from "./sharing-ui-contract";

export function parseSharingInviteToken(
  value: string | readonly string[] | undefined,
): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function SharingInviteScreen({
  controller,
  token,
}: {
  readonly controller: SharingController;
  readonly token: string | readonly string[] | undefined;
}) {
  const palette = usePalette();
  const action = useSharingAction(controller);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const parsedToken = parseSharingInviteToken(token);
  const [acceptedToken, setAcceptedToken] = useState<string | null>(null);
  const result = acceptedToken === parsedToken ? controller.claimResult : null;
  useEffect(() => {
    setAcceptedToken(null);
  }, [parsedToken]);
  if (!parsedToken)
    return (
      <ScreenScrollView surface="groupedBackground">
        <SharingParagraph>Dieser Einladungslink ist ungültig.</SharingParagraph>
        <SharingParagraph>Bitte frage nach einer neuen Einladung.</SharingParagraph>
      </ScreenScrollView>
    );
  if (controller.status === "loading") return <LoadingView label="Einladung wird vorbereitet …" />;
  if (controller.status === "unavailable") return <SharingUnavailableScreen />;
  const name = displayName ?? controller.account?.displayName ?? "";
  return (
    <ScreenScrollView surface="groupedBackground">
      <SharingStatus busy={action.busy} failed={action.failed} />
      <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
        <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>
          {result
            ? result.status === "PENDING"
              ? "Anfrage gesendet"
              : "Kalender freigegeben"
            : "Einladung zu einem Kalender"}
        </Text>
        {result ? (
          <>
            <SharingParagraph>{result.calendarName}</SharingParagraph>
            <SharingParagraph>
              {result.status === "PENDING"
                ? "Die Person muss deinen Zugriff noch bestätigen. Danach erscheint der Kalender unter Kalender teilen."
                : "Du findest diesen Kalender unter Kalender teilen. Du kannst ihn ansehen oder wieder verlassen."}
            </SharingParagraph>
          </>
        ) : (
          <>
            <SharingParagraph>
              Fordere Zugriff an. Die Person bestätigt dich, bevor Kalenderdaten sichtbar werden.
            </SharingParagraph>
            <SharingParagraph>
              Du kannst den Kalender nur ansehen. Deine eigenen Dienste bleiben unverändert.
            </SharingParagraph>
          </>
        )}
      </SurfaceCard>
      {result ? null : controller.status === "signedOut" ? (
        <>
          <SignInActions controller={controller} run={action.run} busy={action.busy} />
          <SharingParagraph>Dein eigener Kalender bleibt ohne Konto nutzbar.</SharingParagraph>
        </>
      ) : (
        <View style={{ gap: SPACING.xl }}>
          <Field
            label="Dein Anzeigename"
            value={name}
            maxLength={64}
            editable={!action.busy}
            onChangeText={setDisplayName}
          />
          <PrimaryButton
            disabled={action.busy || name.trim().length === 0}
            onPress={() =>
              void action
                .run(() => controller.claimInvite(parsedToken, name.trim()))
                .then((accepted) => {
                  if (accepted) setAcceptedToken(parsedToken);
                })
            }
          >
            Zugriff anfordern
          </PrimaryButton>
        </View>
      )}
    </ScreenScrollView>
  );
}
