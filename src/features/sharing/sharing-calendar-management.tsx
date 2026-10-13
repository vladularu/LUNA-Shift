import type { Dispatch, SetStateAction } from "react";
import { Alert } from "react-native";
import { RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { LabeledSwitch } from "@/ui/labeled-switch";
import {
  SharingParagraph,
  SharingStatus,
  updateLabel,
  useSharingAction,
} from "./sharing-ui-elements";
import type {
  SharingCalendarView,
  SharingController,
  SharingPublicationPreview,
} from "./sharing-ui-contract";
export function confirmSharingAction(title: string, action: () => void) {
  Alert.alert(title, "Deine eigenen Dienste bleiben erhalten.", [
    { text: "Abbrechen", style: "cancel" },
    { text: "Bestätigen", style: "destructive", onPress: action },
  ]);
}
const confirm = confirmSharingAction;
function stateLabel(calendar: SharingCalendarView) {
  if (calendar.publicationPaused) return "Freigabe pausiert · bitte prüfen";
  if (calendar.syncState === "otherDevice") return "Wird auf einem anderen Gerät geteilt";
  if (calendar.syncState === "pending") return "Änderungen warten auf Übertragung";
  if (calendar.syncState === "expired") return "Verbindung zum Aktualisieren benötigt";
  return `${calendar.syncState === "offline" ? "Offline · " : ""}Stand: ${updateLabel(calendar.publishedAt)}`;
}
export function SharingCalendarManagement({
  controller,
  action,
  mode,
  selected,
  recovery,
  setRecovery,
  setMode,
  onInvite,
  onBack,
  now,
}: {
  readonly controller: SharingController;
  readonly action: ReturnType<typeof useSharingAction>;
  readonly mode: string;
  readonly selected: SharingCalendarView | undefined;
  readonly recovery: SharingPublicationPreview | null;
  readonly setRecovery: Dispatch<SetStateAction<SharingPublicationPreview | null>>;
  readonly setMode: (mode: "overview" | "manage" | "recovery") => void;
  readonly onInvite: (id: string) => void;
  readonly onBack: () => void;
  readonly now: number;
}) {
  const status = <SharingStatus busy={action.busy} failed={action.failed} />;
  const back = (
    <SecondaryButton disabled={action.busy} onPress={onBack}>
      Zurück zur Übersicht
    </SecondaryButton>
  );
  if (mode === "account")
    return (
      <>
        {status}
        <SectionHeader title="Konto" caption={controller.account?.displayName} />
        <SurfaceCard>
          <RowButton
            title="Abmelden"
            disabled={action.busy}
            onPress={() => confirm("Abmelden?", () => void action.run(() => controller.signOut()))}
          />
          <RowButton
            title="Konto löschen"
            destructive
            disabled={action.busy || !controller.accountDeletionAvailable}
            onPress={() =>
              confirm(
                "Cloud-Konto und Freigaben dauerhaft löschen?",
                () => void action.run(() => controller.deleteAccount()),
              )
            }
          />
        </SurfaceCard>
        {back}
      </>
    );

  if (mode === "recovery" && selected && recovery)
    return (
      <>
        {status}
        <SectionHeader
          title="Freigabe fortsetzen"
          caption="Nach Wiederherstellung oder Übertragungskonflikt"
        />
        <SharingParagraph>
          Prüfe den Stand auf diesem Gerät. Nach Bestätigung werden künftige Änderungen wieder
          automatisch geteilt.
        </SharingParagraph>
        <SurfaceCard>
          {recovery.entries.slice(0, 6).map((item, index) => (
            <RowButton key={index} title={item.title} subtitle={item.when} />
          ))}
        </SurfaceCard>
        <PrimaryButton
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              try {
                await controller.publishCalendar(selected.id, recovery.confirmationId);
              } finally {
                setRecovery(null);
                setMode("manage");
              }
            })
          }
        >
          Freigabe fortsetzen
        </PrimaryButton>
        {back}
      </>
    );

  if (mode === "manage" && selected)
    return (
      <>
        {status}
        <SectionHeader title={selected.name} caption={stateLabel(selected)} />
        <SharingParagraph>
          {selected.visibility === "DETAILS"
            ? "Dienstnamen und Zeiten · alle Monate · nur ansehen"
            : "Nur Verfügbarkeit · alle Monate · nur ansehen"}
        </SharingParagraph>
        {selected.isOwner ? (
          <>
            <PrimaryButton disabled={action.busy} onPress={() => onInvite(selected.id)}>
              Neue Einladung
            </PrimaryButton>
            {selected.publicationPaused ? (
              <SecondaryButton
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    setRecovery(await controller.preparePublicationPreview(selected.id));
                    setMode("recovery");
                  })
                }
              >
                Freigabe prüfen
              </SecondaryButton>
            ) : null}
            <SectionHeader title="Personen mit Zugriff" />
            {selected.members
              .filter((member) => ["ACTIVE", "PENDING"].includes(member.status))
              .map((member) => (
                <SurfaceCard key={member.userId}>
                  <RowButton
                    title={member.displayName}
                    subtitle={
                      member.status === "PENDING"
                        ? "Möchte deinen Dienstplan ansehen"
                        : "Kann nur ansehen"
                    }
                  />
                  {member.status === "PENDING" ? (
                    <>
                      <RowButton
                        title="Erlauben"
                        accessibilityLabel={`${member.displayName} erlauben`}
                        disabled={action.busy}
                        onPress={() =>
                          void action.run(() =>
                            controller.setMember(selected.id, member.userId, "APPROVE"),
                          )
                        }
                      />
                      <RowButton
                        title="Ablehnen"
                        accessibilityLabel={`${member.displayName} ablehnen`}
                        disabled={action.busy}
                        onPress={() =>
                          void action.run(() =>
                            controller.setMember(selected.id, member.userId, "REJECT"),
                          )
                        }
                      />
                    </>
                  ) : (
                    <RowButton
                      title="Zugriff entfernen"
                      accessibilityLabel={`Zugriff für ${member.displayName} entfernen`}
                      destructive
                      disabled={action.busy}
                      onPress={() =>
                        confirm(
                          `Freigabe für ${member.displayName} beenden?`,
                          () =>
                            void action.run(() =>
                              controller.setMember(selected.id, member.userId, "REVOKE"),
                            ),
                        )
                      }
                    />
                  )}
                </SurfaceCard>
              ))}
            {selected.invites
              .filter(
                (item) => !item.consumedAt && !item.revokedAt && Date.parse(item.expiresAt) > now,
              )
              .map((item) => (
                <SurfaceCard key={item.id}>
                  <RowButton
                    title="Offene Einladung"
                    subtitle={`Gültig bis ${updateLabel(item.expiresAt)}`}
                  />
                  <RowButton
                    title="Einladung stoppen"
                    destructive
                    disabled={action.busy}
                    onPress={() =>
                      void action.run(() => controller.revokeInvite(selected.id, item.id))
                    }
                  />
                </SurfaceCard>
              ))}
          </>
        ) : (
          <LabeledSwitch
            label="Im Kalender und Widget anzeigen"
            value={selected.visible}
            disabled={action.busy}
            onValueChange={(value) =>
              void action.run(() => controller.setVisible(selected.id, value))
            }
          />
        )}
        <SurfaceCard>
          <RowButton
            title={selected.isOwner ? "Freigabe beenden" : "Kalender verlassen"}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirm(
                selected.isOwner ? "Freigabe für alle beenden?" : "Kalender verlassen?",
                () =>
                  void action.run(async () => {
                    if (selected.isOwner) await controller.deleteCalendar(selected.id);
                    else await controller.leaveCalendar(selected.id);
                    setMode("overview");
                  }),
              )
            }
          />
        </SurfaceCard>
        {back}
      </>
    );

  return null;
}
