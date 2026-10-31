import { Alert, View, useWindowDimensions } from "react-native";
import type { SharingContentRights } from "@/domain/sharing-content";
import type { SharingController } from "./sharing-ui-contract";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { RowButton, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton, ResponsiveFieldRow, SecondaryButton } from "@/ui/form-controls";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { sharedPersonPresentation, useSharingPhotoView } from "./sharing-person-photos";
import { SharingPerson, SharingSelection } from "./sharing-flow-layout";
import { SharingParagraph, SharingStatus, useSharingAction } from "./sharing-ui-elements";

export function CalendarAccessScreen({
  controller,
  calendarId,
  memberId,
  onBack,
}: {
  readonly controller: SharingController;
  readonly calendarId: string;
  readonly memberId: string;
  readonly onBack: () => void;
}) {
  const palette = usePalette();
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 880 || fontScale > 1.1;
  const pillStyle = {
    borderRadius: RADII.pill,
    borderWidth: 0,
    backgroundColor: palette.surfaceRaised,
  };
  const headingStyle = {
    ...TYPOGRAPHY.sectionTitle,
    color: palette.textSecondary,
    paddingHorizontal: SPACING.lg,
  };
  const hintStyle = {
    ...TYPOGRAPHY.compactCaption,
    color: palette.textMuted,
    paddingHorizontal: SPACING.lg,
  };
  const action = useSharingAction(controller);
  const selected = controller.calendars.find(
    (calendar) => calendar.id === calendarId && calendar.isOwner,
  );
  const selectedMember = selected?.members.find(
    (member) => member.userId === memberId && ["ACTIVE", "PENDING"].includes(member.status),
  );
  const person = sharedPersonPresentation(controller, selectedMember?.userId ?? "");
  useSharingPhotoView(controller, selectedMember ? person.calendarIds : []);
  const memberRights = selectedMember?.rights ?? {
    shifts: true,
    appointments: !!selected?.selectedAppointmentIds?.length,
    notes: false,
  };
  function changeRights(key: keyof SharingContentRights, value: boolean) {
    if (
      !selected ||
      !selectedMember ||
      !controller.setMemberRights ||
      !controller.contentRightsAvailable
    )
      return;
    void action.run(
      () =>
        controller.setMemberRights!(selected.id, selectedMember.userId, {
          ...memberRights,
          [key]: value,
        }),
      "Zugriffsrechte konnten nicht gespeichert werden. Versuche es erneut.",
    );
  }
  const status = (
    <SharingStatus busy={false} failed={action.failed} message={action.failureMessage} />
  );
  return (
    <BackFooterLayout
      testID="calendar-access-screen"
      label="Zurück zur Übersicht"
      onPress={onBack}
      style={{ backgroundColor: palette.groupedBackground }}
    >
      {(bottomPadding) => (
        <ScreenScrollView
          surface="groupedBackground"
          bottomPadding={bottomPadding}
          contentGap={compact ? SPACING.lg : SPACING.xl}
          contentContainerStyle={{ paddingTop: compact ? SPACING.sm : SPACING.md }}
        >
          {controller.status === "loading" ? (
            <LoadingView label="Freigaben werden geladen …" />
          ) : controller.status === "signedIn" && selected && selectedMember ? (
            <>
              {status}
              <SharingPerson
                key={selectedMember.userId}
                name={selectedMember.displayName}
                compact={compact}
                photoUri={person.photoUri}
                color={person.color}
              />
              <View style={{ gap: SPACING.sm }}>
                <Text accessibilityRole="header" style={headingStyle}>
                  Schichten
                </Text>
                <SharingSelection
                  pill
                  title={selected.name}
                  label="Schichten freigeben"
                  selected={memberRights.shifts}
                  disabled={action.busy || !controller.contentRightsAvailable}
                  onPress={() => changeRights("shifts", !memberRights.shifts)}
                />
              </View>
              <View style={{ gap: SPACING.sm }}>
                <Text accessibilityRole="header" style={headingStyle}>
                  Termine
                </Text>
                <SharingSelection
                  pill
                  title="Termine"
                  label="Termine freigeben"
                  selected={
                    selectedMember.rights?.appointments ?? !!selected.selectedAppointmentIds?.length
                  }
                  disabled={action.busy || !controller.contentRightsAvailable}
                  onPress={() => changeRights("appointments", !memberRights.appointments)}
                />
              </View>
              <View style={{ gap: SPACING.sm }}>
                <SurfaceCard style={pillStyle}>
                  <RowButton
                    title="Notizen"
                    trailing={
                      <LabeledSwitch
                        label="Notizen freigeben"
                        value={memberRights.notes}
                        disabled={action.busy || !controller.contentRightsAvailable}
                        onValueChange={(value) => changeRights("notes", value)}
                      />
                    }
                  />
                </SurfaceCard>
                <Text style={hintStyle}>
                  {selectedMember.status === "PENDING"
                    ? "Erst nach deiner Bestätigung sichtbar."
                    : "Nur ansehen. Bearbeiten ist nicht erlaubt."}
                </Text>
              </View>
              <View style={{ gap: SPACING.sm }}>
                <SurfaceCard style={pillStyle}>
                  <RowButton
                    title="Profilbild teilen"
                    trailing={
                      <LabeledSwitch
                        label="Profilbild teilen"
                        value={selectedMember.shareProfilePhoto ?? false}
                        disabled={
                          action.busy ||
                          !controller.profilePhotosAvailable ||
                          !controller.setMemberProfilePhoto
                        }
                        onValueChange={(allowed) =>
                          void action.run(
                            () =>
                              controller.setMemberProfilePhoto!(
                                selected.id,
                                selectedMember.userId,
                                allowed,
                              ),
                            "Die Profilbild-Freigabe konnte nicht gespeichert werden. Versuche es erneut.",
                          )
                        }
                      />
                    }
                  />
                </SurfaceCard>
                <Text style={hintStyle}>Dein Foto ist für diese Person sichtbar.</Text>
              </View>
              {selectedMember.status === "PENDING" ? (
                <ResponsiveFieldRow>
                  <PrimaryButton
                    shape="pill"
                    disabled={action.busy}
                    onPress={() =>
                      void action.run(
                        () => controller.setMember(selected.id, selectedMember.userId, "APPROVE"),
                        "Zugriff konnte nicht erlaubt werden. Versuche es erneut.",
                      )
                    }
                  >
                    Zugriff erlauben
                  </PrimaryButton>
                  <SecondaryButton
                    shape="pill"
                    disabled={action.busy}
                    onPress={() =>
                      void action.run(async () => {
                        await controller.setMember(selected.id, selectedMember.userId, "REJECT");
                        onBack();
                      }, "Anfrage konnte nicht abgelehnt werden. Versuche es erneut.")
                    }
                  >
                    Anfrage ablehnen
                  </SecondaryButton>
                </ResponsiveFieldRow>
              ) : (
                <PrimaryButton
                  shape="pill"
                  danger
                  disabled={action.busy}
                  onPress={() =>
                    Alert.alert(
                      `Freigabe für ${selectedMember.displayName} beenden?`,
                      "Deine eigenen Dienste bleiben erhalten.",
                      [
                        { text: "Abbrechen", style: "cancel" },
                        {
                          text: "Zugriff entfernen",
                          style: "destructive",
                          onPress: () =>
                            void action.run(async () => {
                              await controller.setMember(
                                selected.id,
                                selectedMember.userId,
                                "REVOKE",
                              );
                              onBack();
                            }, "Zugriff konnte nicht entfernt werden. Versuche es erneut."),
                        },
                      ],
                    )
                  }
                >
                  Zugriff entfernen
                </PrimaryButton>
              )}
            </>
          ) : (
            <SharingParagraph>Diese Freigabe ist nicht mehr verfügbar.</SharingParagraph>
          )}
        </ScreenScrollView>
      )}
    </BackFooterLayout>
  );
}
