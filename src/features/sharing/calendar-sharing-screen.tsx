import { useEffect, useState } from "react";
import { Modal, View } from "react-native";
import { DEFAULT_SHARING_RIGHTS, type SharingContentRights } from "@/domain/sharing-content";
import { usePalette } from "@/theme/palette";
import { SHARED_CALENDAR_COLORS, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { LoadingView } from "@/ui/loading-view";
import { ScreenScrollView, TabScreenHeader } from "@/ui/screen-layout";
import { Text } from "@/ui/text";
import { SharingCalendarManagement, confirmSharingAction } from "./sharing-calendar-management";
import {
  SharingFlowLayout,
  SharingIconButton,
  SharingPerson,
  SharingSelection,
} from "./sharing-flow-layout";
import { SharingInvitationSend } from "./sharing-invitation-send";
import {
  SharingParagraph,
  SharingStatus,
  SharingUnavailableScreen,
  SignInActions,
  useSharingAction,
} from "./sharing-ui-elements";
import type {
  SharingController,
  SharingInvitation,
  SharingPublicationPreview,
} from "./sharing-ui-contract";

export function invitationTimeRemaining(expiresAt: string, now: number): string {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Abgelaufen";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function CalendarSharingScreen({
  controller,
  onClose,
}: {
  readonly controller: SharingController;
  readonly onClose?: () => void;
}) {
  const palette = usePalette();
  const action = useSharingAction(controller);
  const [mode, setMode] = useState<
    "overview" | "setup" | "ready" | "member" | "manage" | "account" | "recovery"
  >("overview");
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<SharingInvitation | null>(null);
  const [issued, setIssued] = useState<readonly SharingInvitation[]>([]);
  const issuedLinks = [...(controller.issuedInvitations ?? []), ...issued];
  const [now, setNow] = useState(Date.now);
  const [shifts, setShifts] = useState(true);
  const [includeAppointments, setIncludeAppointments] = useState(false);
  const [notes, setNotes] = useState(false);
  const [appointments, setAppointments] = useState<readonly string[]>([]);
  const [recovery, setRecovery] = useState<SharingPublicationPreview | null>(null);
  const own = controller.calendars.filter((item) => item.isOwner);
  const incoming = controller.calendars.filter((item) => !item.isOwner);
  const selected = controller.calendars.find((item) => item.id === calendarId);
  const selectedMember = selected?.members.find(
    (item) => item.userId === memberId && ["ACTIVE", "PENDING"].includes(item.status),
  );
  const members = own.flatMap((calendar) =>
    calendar.members
      .filter((member) => ["ACTIVE", "PENDING"].includes(member.status))
      .map((member) => ({ calendar, member })),
  );
  const activeInvites = own.flatMap((calendar) =>
    calendar.invites
      .filter((item) => !item.consumedAt && !item.revokedAt && Date.parse(item.expiresAt) > now)
      .map((item) => ({ calendar, item })),
  );
  const status = <SharingStatus busy={action.busy} failed={action.failed} />;
  const home = () => setMode("overview");
  const hasInvites = own.some((calendar) =>
    calendar.invites.some((item) => !item.consumedAt && !item.revokedAt),
  );
  useEffect(() => {
    if (!hasInvites && !invitation) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasInvites, invitation]);
  useEffect(() => {
    if (controller.status !== "signedIn") {
      setInvitation(null);
      setIssued([]);
      setMode("overview");
      setCalendarId(null);
      setMemberId(null);
    }
  }, [controller.status]);
  function invite(id?: string) {
    const calendar =
      own.find((item) => item.id === id) ??
      own.find(
        (item) =>
          item.visibility === "DETAILS" &&
          !item.publicationPaused &&
          item.syncState !== "otherDevice",
      );
    setCalendarId(calendar?.id ?? null);
    setShifts(DEFAULT_SHARING_RIGHTS.shifts);
    setIncludeAppointments(false);
    setNotes(false);
    setAppointments(calendar?.selectedAppointmentIds ?? []);
    setInvitation(null);
    setMode("setup");
  }
  function manage(id: string) {
    setCalendarId(id);
    setMode("manage");
  }
  async function prepare(id: string) {
    const next = controller.contentRightsAvailable
      ? await controller.createInvitation(id, { shifts, appointments: includeAppointments, notes })
      : await controller.createInvitation(id);
    setCalendarId(id);
    setInvitation(next);
    setIssued((old) => [...old.filter((item) => item.id !== next.id), next]);
    setMode("ready");
  }
  async function next() {
    // Keep the created binding on failure so retrying never creates another calendar.
    let id = calendarId;
    const calendar = own.find((item) => item.id === id);
    const sameAppointments =
      calendar &&
      JSON.stringify([...appointments].sort()) ===
        JSON.stringify([...(calendar.selectedAppointmentIds ?? [])].sort());
    if (
      !id ||
      (calendar &&
        (calendar.visibility !== "DETAILS" ||
          (!controller.contentRightsAvailable && !sameAppointments)))
    ) {
      id = await controller.createCalendar({
        name: controller.account?.displayName || "Mein Dienstplan",
        color: SHARED_CALENDAR_COLORS[0].color,
        visibility: "DETAILS",
        confirmed: true,
        selectedAppointmentIds: appointments,
        ...(controller.contentRightsAvailable
          ? { rights: { shifts, appointments: includeAppointments, notes } }
          : {}),
      });
      setCalendarId(id);
    }
    await prepare(id);
  }

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
    void action.run(() =>
      controller.setMemberRights!(selected.id, selectedMember.userId, {
        ...memberRights,
        [key]: value,
      }),
    );
  }
  if (controller.status === "loading" || controller.status === "unavailable")
    return (
      <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
        {onClose ? (
          <TabScreenHeader
            title="Teilen"
            surface="groupedBackground"
            accessory={
              <SharingIconButton
                label="Zurück zum Kalender"
                icon="chevron-back"
                onPress={onClose}
              />
            }
          />
        ) : null}
        {controller.status === "loading" ? (
          <LoadingView label="Freigaben werden geladen …" />
        ) : (
          <SharingUnavailableScreen />
        )}
      </View>
    );
  if (controller.status === "signedOut")
    return (
      <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
        <TabScreenHeader
          title="Teilen"
          surface="groupedBackground"
          accessory={
            onClose ? (
              <SharingIconButton
                label="Zurück zum Kalender"
                icon="chevron-back"
                onPress={onClose}
              />
            ) : undefined
          }
        />
        <ScreenScrollView surface="groupedBackground">
          {status}
          <SectionHeader title="Gemeinsam den Alltag planen" />
          <SharingParagraph>
            Melde dich an, um deinen Dienstplan zu teilen oder eine Einladung anzunehmen.
          </SharingParagraph>
          <SignInActions controller={controller} run={action.run} busy={action.busy} />
          <SharingParagraph>Dein eigener Kalender bleibt ohne Konto nutzbar.</SharingParagraph>
        </ScreenScrollView>
      </View>
    );
  if (["manage", "account", "recovery"].includes(mode))
    return (
      <SharingFlowLayout title={mode === "account" ? "Konto" : "Freigabe verwalten"} onBack={home}>
        <SharingCalendarManagement
          controller={controller}
          action={action}
          mode={mode}
          selected={selected}
          recovery={recovery}
          setRecovery={setRecovery}
          setMode={setMode}
          onInvite={invite}
          onBack={home}
          now={now}
        />
      </SharingFlowLayout>
    );
  if (mode === "member" && selected?.isOwner && selectedMember)
    return (
      <SharingFlowLayout title="Kalenderzugriff" onBack={home}>
        {status}
        <SharingPerson name={selectedMember.displayName} />
        <View style={{ gap: SPACING.md }}>
          <SectionHeader title="Schichten" />
          <SharingSelection
            title={selected.name}
            label="Schichten freigeben"
            selected={memberRights.shifts}
            disabled={action.busy || !controller.contentRightsAvailable}
            onPress={() => changeRights("shifts", !memberRights.shifts)}
          />
        </View>
        <View style={{ gap: SPACING.md }}>
          <SectionHeader title="Termine" />
          <SharingSelection
            title="Termine"
            label="Termine freigeben"
            selected={
              selectedMember.rights?.appointments ?? !!selected.selectedAppointmentIds?.length
            }
            disabled={action.busy || !controller.contentRightsAvailable}
            onPress={() => changeRights("appointments", !memberRights.appointments)}
          />
        </View>
        <SurfaceCard>
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
        <SharingParagraph>{`Diese Inhalte sind für ${selectedMember.displayName} freigegeben. Änderungen sind nicht erlaubt.`}</SharingParagraph>
        {selectedMember.status === "PENDING" ? (
          <>
            <PrimaryButton
              disabled={action.busy}
              onPress={() =>
                void action.run(() =>
                  controller.setMember(selected.id, selectedMember.userId, "APPROVE"),
                )
              }
            >
              Zugriff erlauben
            </PrimaryButton>
            <SecondaryButton
              disabled={action.busy}
              onPress={() =>
                void action.run(async () => {
                  await controller.setMember(selected.id, selectedMember.userId, "REJECT");
                  home();
                })
              }
            >
              Anfrage ablehnen
            </SecondaryButton>
          </>
        ) : (
          <PrimaryButton
            danger
            disabled={action.busy}
            onPress={() =>
              confirmSharingAction(
                `Freigabe für ${selectedMember.displayName} beenden?`,
                () =>
                  void action.run(async () => {
                    await controller.setMember(selected.id, selectedMember.userId, "REVOKE");
                    home();
                  }),
              )
            }
          >
            Freigabe beenden
          </PrimaryButton>
        )}
        <SecondaryButton onPress={home}>Zurück zur Übersicht</SecondaryButton>
      </SharingFlowLayout>
    );
  const record = invitation && selected?.invites.find((item) => item.id === invitation.id);
  const valid =
    !!selected?.isOwner &&
    !!record &&
    !record.consumedAt &&
    !record.revokedAt &&
    Date.parse(record.expiresAt) > now &&
    !!invitation &&
    Date.parse(invitation.expiresAt) > now;
  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={mode !== "overview"}
        importantForAccessibility={mode !== "overview" ? "no-hide-descendants" : "auto"}
      >
        <TabScreenHeader
          title="Teilen"
          surface="groupedBackground"
          accessory={
            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              {onClose ? (
                <SharingIconButton
                  label="Zurück zum Kalender"
                  icon="chevron-back"
                  onPress={onClose}
                />
              ) : null}
              <SharingIconButton
                label="Neue Einladung erstellen"
                icon="add"
                disabled={action.busy}
                onPress={() => invite()}
              />
            </View>
          }
        />
        <ScreenScrollView surface="groupedBackground">
          {mode === "overview" ? status : null}
          <View style={{ gap: SPACING.md }}>
            <SectionHeader title="Personen mit Zugriff auf meinen Kalender" />
            {members.length ? (
              <SurfaceCard>
                {members.map(({ calendar, member }, index) => (
                  <View key={`${calendar.id}:${member.userId}`}>
                    {index ? <CardSeparator /> : null}
                    <RowButton
                      title={member.displayName}
                      subtitle={
                        member.status === "PENDING" ? `${calendar.name} · Anfrage` : calendar.name
                      }
                      accessibilityLabel={`Kalenderzugriff für ${member.displayName}`}
                      disabled={action.busy}
                      onPress={() => {
                        setCalendarId(calendar.id);
                        setMemberId(member.userId);
                        setMode("member");
                      }}
                    />
                  </View>
                ))}
              </SurfaceCard>
            ) : (
              <SharingParagraph>Noch niemand eingeladen.</SharingParagraph>
            )}
          </View>
          {activeInvites.length ? (
            <View style={{ gap: SPACING.md }}>
              <SectionHeader title="Aktive Einladungslinks" />
              {activeInvites.map(({ calendar, item }) => {
                const link = issuedLinks.find(
                  (value) => value.id === item.id && value.calendarId === calendar.id,
                );
                return (
                  <SurfaceCard key={item.id}>
                    <RowButton
                      title={link?.url ?? "Einladung"}
                      subtitle={
                        !link
                          ? item.rights
                            ? "Link auf dem ursprünglichen Gerät"
                            : "Einmal verwendbar · Link auf dem ursprünglichen Gerät"
                          : undefined
                      }
                      onPress={
                        link
                          ? () => {
                              setCalendarId(calendar.id);
                              setInvitation(link);
                              setMode("ready");
                            }
                          : undefined
                      }
                      accessibilityLabel="Einladung öffnen"
                    />
                    <CardSeparator />
                    {link ? (
                      <RowButton
                        title={
                          controller.directCopyAvailable
                            ? "Link kopieren"
                            : "Link teilen oder kopieren"
                        }
                        disabled={action.busy}
                        onPress={() =>
                          void action.run(() => controller.shareInvitation(link, "copy"))
                        }
                      />
                    ) : null}
                    <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
                      <Text
                        maxFontSizeMultiplier={TEXT_MAX_SCALE}
                        style={{ ...TYPOGRAPHY.bodyStrong, color: palette.primary }}
                      >{`Läuft ab in: ${invitationTimeRemaining(item.expiresAt, now)}`}</Text>
                      <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>
                        {calendar.name}
                      </Text>
                      <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                        {item.rights
                          ? `${item.joinedCount ?? 0} beigetreten`
                          : "0 beigetreten · einmal verwendbar"}
                      </Text>
                    </View>
                    <RowButton
                      title="Stop"
                      accessibilityLabel="Einladung stoppen"
                      destructive
                      disabled={action.busy}
                      onPress={() =>
                        void action.run(() => controller.revokeInvite(calendar.id, item.id))
                      }
                    />
                  </SurfaceCard>
                );
              })}
            </View>
          ) : null}
          <PrimaryButton disabled={action.busy} onPress={() => invite()}>
            Neue Einladung
          </PrimaryButton>
          {incoming.length ? (
            <View style={{ gap: SPACING.md }}>
              <SectionHeader title="Mit dir geteilt" />
              <SurfaceCard>
                {incoming.map((calendar, index) => (
                  <View key={calendar.id}>
                    {index ? <CardSeparator /> : null}
                    <RowButton
                      title={calendar.name}
                      accessibilityLabel={`${calendar.name} ansehen`}
                      onPress={() => manage(calendar.id)}
                      trailing={
                        <LabeledSwitch
                          label={`${calendar.name} anzeigen`}
                          value={calendar.visible}
                          disabled={action.busy}
                          onValueChange={(on) =>
                            void action.run(() => controller.setVisible(calendar.id, on))
                          }
                        />
                      }
                    />
                  </View>
                ))}
              </SurfaceCard>
            </View>
          ) : null}
          <SurfaceCard>
            {own.map((calendar) => (
              <RowButton
                key={calendar.id}
                title={calendar.name}
                subtitle={calendar.publicationPaused ? "Freigabe prüfen" : "Freigabe verwalten"}
                accessibilityLabel={`${calendar.name} verwalten`}
                onPress={() => manage(calendar.id)}
              />
            ))}
            <RowButton
              title="Konto"
              accessibilityLabel="Konto"
              subtitle={controller.account?.displayName}
              onPress={() => setMode("account")}
            />
          </SurfaceCard>
        </ScreenScrollView>
      </View>
      <Modal
        visible={mode === "setup" || mode === "ready"}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={home}
      >
        <SharingFlowLayout
          title={mode === "ready" ? "Sende deine Einladung" : "Neue Einladung"}
          onBack={home}
          close
          footer={
            mode === "setup" ? (
              <PrimaryButton
                disabled={
                  action.busy ||
                  (!shifts && !(controller.contentRightsAvailable && includeAppointments))
                }
                onPress={() => void action.run(next)}
              >
                Weiter
              </PrimaryButton>
            ) : undefined
          }
        >
          {status}
          {mode === "setup" ? (
            <>
              <SectionHeader title="Was möchtest du teilen?" />
              <View style={{ gap: SPACING.md }}>
                <SectionHeader title="Schichten" />
                <SharingSelection
                  title={selected?.name ?? "Mein Dienstplan"}
                  label="Schichten teilen"
                  selected={shifts}
                  disabled={action.busy}
                  onPress={() => setShifts((value) => !value)}
                />
              </View>
              <View style={{ gap: SPACING.md }}>
                <SectionHeader title="Termine" />
                <SharingSelection
                  title="Termine"
                  label="Termine teilen"
                  selected={
                    controller.contentRightsAvailable
                      ? includeAppointments
                      : appointments.length > 0
                  }
                  disabled={
                    action.busy ||
                    (!controller.contentRightsAvailable && !controller.availableAppointments.length)
                  }
                  onPress={() =>
                    controller.contentRightsAvailable
                      ? setIncludeAppointments((old) => !old)
                      : setAppointments((old) =>
                          old.length ? [] : controller.availableAppointments.map((item) => item.id),
                        )
                  }
                />
              </View>
              <SurfaceCard>
                <RowButton
                  title="Notizen"
                  trailing={
                    <LabeledSwitch
                      label="Notizen teilen"
                      value={notes}
                      disabled={action.busy || !controller.contentRightsAvailable}
                      onValueChange={setNotes}
                    />
                  }
                />
              </SurfaceCard>
              <SharingParagraph>
                Wähle aus, was andere sehen können. Andere können keine Änderungen vornehmen.
              </SharingParagraph>
              {!controller.contentRightsAvailable ? (
                <SharingParagraph>Notizen werden derzeit nicht geteilt.</SharingParagraph>
              ) : null}
            </>
          ) : valid && invitation ? (
            <SharingInvitationSend
              url={invitation.url}
              busy={action.busy}
              onSend={(channel) =>
                void action.run(() => controller.shareInvitation(invitation, channel))
              }
            />
          ) : (
            <>
              <SharingParagraph>
                Diese Einladung ist nicht mehr gültig oder wurde bereits angenommen.
              </SharingParagraph>
              <PrimaryButton disabled={action.busy} onPress={() => invite(calendarId ?? undefined)}>
                Neue Einladung
              </PrimaryButton>
            </>
          )}
        </SharingFlowLayout>
      </Modal>
    </View>
  );
}
