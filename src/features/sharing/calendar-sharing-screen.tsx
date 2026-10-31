import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Modal, View } from "react-native";
import { DEFAULT_SHARING_RIGHTS } from "@/domain/sharing-content";
import { usePalette } from "@/theme/palette";
import { SHARED_CALENDAR_COLORS, SPACING } from "@/theme/tokens";
import { CardSeparator, RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { LoadingView } from "@/ui/loading-view";
import { ScreenScrollView, TabScreenHeader } from "@/ui/screen-layout";
import { SharingPublicationRecovery } from "./sharing-publication-recovery";
import { SharingFlowLayout, SharingIconButton, SharingSelection } from "./sharing-flow-layout";
import { SharingActiveInvitationCard } from "./sharing-active-invitation-card";
import { PersonAvatar } from "@/ui/person-avatar";
import { sharedPersonPresentation, useVisibleSharingPhotos } from "./sharing-person-photos";
import { SharingCalendarColorPicker } from "./sharing-calendar-color-picker";
import { SharingInvitationSend } from "./sharing-invitation-send";
import { AccountSyncNotice } from "@/features/account/account-status";
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
  const visibilityRequests = useRef(new Map<string, number>());
  const [visibilityErrors, setVisibilityErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const setCalendarVisible = (id: string, visible: boolean) => {
    const revision = (visibilityRequests.current.get(id) ?? 0) + 1;
    visibilityRequests.current.set(id, revision);
    setVisibilityErrors((old) => {
      const next = new Map(old);
      next.delete(id);
      return next;
    });
    void controller.setVisible(id, visible).catch((error: unknown) => {
      if (
        error instanceof Error &&
        ["SHARE_ACCOUNT_CHANGED", "SHARE_NOT_FOUND"].includes(error.message)
      )
        return;
      if (visibilityRequests.current.get(id) !== revision) return;
      setVisibilityErrors((old) =>
        new Map(old).set(id, "Anzeige konnte nicht gespeichert werden. Versuche es erneut."),
      );
    });
  };
  const [mode, setMode] = useState<"overview" | "setup" | "ready" | "recovery">("overview");
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<SharingInvitation | null>(null);
  const [issued, setIssued] = useState<readonly SharingInvitation[]>([]);
  const issuedLinks = [...(controller.issuedInvitations ?? []), ...issued];
  const [now, setNow] = useState(Date.now);
  const [shifts, setShifts] = useState(true);
  const [includeAppointments, setIncludeAppointments] = useState(false);
  const [notes, setNotes] = useState(false);
  const [shareProfilePhoto, setShareProfilePhoto] = useState(false);
  const [appointments, setAppointments] = useState<readonly string[]>([]);
  const [recovery, setRecovery] = useState<SharingPublicationPreview | null>(null);
  const own = controller.calendars.filter((item) => item.isOwner);
  const incoming = controller.calendars.filter((item) => !item.isOwner);
  const selected = controller.calendars.find((item) => item.id === calendarId);
  const members = own.flatMap((calendar) =>
    calendar.members
      .filter((member) => ["ACTIVE", "PENDING"].includes(member.status))
      .map((member) => ({ calendar, member })),
  );
  const photos = useVisibleSharingPhotos(controller, [
    ...members.map(({ calendar, member }) => ({
      key: "member:" + calendar.id + ":" + member.userId,
      section: "members" as const,
      calendarIds: sharedPersonPresentation(controller, member.userId).calendarIds,
    })),
    ...incoming.map((calendar) => ({
      key: "incoming:" + calendar.id,
      section: "incoming" as const,
      calendarIds: [calendar.id],
    })),
  ]);
  const activeInvites = own.flatMap((calendar) =>
    calendar.invites
      .filter((item) => !item.consumedAt && !item.revokedAt && Date.parse(item.expiresAt) > now)
      .map((item) => ({ calendar, item })),
  );
  const status = (
    <SharingStatus busy={action.busy} failed={action.failed} message={action.failureMessage} />
  );
  const home = () => {
    setRecovery(null);
    setMode("overview");
  };
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
      setRecovery(null);
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
    setShareProfilePhoto(false);
    setAppointments(calendar?.selectedAppointmentIds ?? []);
    setInvitation(null);
    setMode("setup");
  }
  async function prepare(id: string) {
    const next = controller.contentRightsAvailable
      ? controller.profilePhotosAvailable
        ? await controller.createInvitation(
            id,
            { shifts, appointments: includeAppointments, notes },
            shareProfilePhoto,
          )
        : await controller.createInvitation(id, {
            shifts,
            appointments: includeAppointments,
            notes,
          })
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
          <SectionHeader title="Gemeinsam planen" />
          <SharingParagraph>
            Automatisch synchronisieren und deinen Dienstplan teilen.
          </SharingParagraph>
          <SignInActions controller={controller} run={action.run} busy={action.busy} />
        </ScreenScrollView>
      </View>
    );
  if (mode === "recovery")
    return (
      <SharingFlowLayout title="Freigabe fortsetzen" onBack={home}>
        {selected?.isOwner && recovery ? (
          <SharingPublicationRecovery
            controller={controller}
            action={action}
            calendarId={selected.id}
            preview={recovery}
            onBack={home}
          />
        ) : (
          <SharingParagraph>Diese Freigabe ist nicht mehr verfügbar.</SharingParagraph>
        )}
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
            onClose ? (
              <SharingIconButton
                label="Zurück zum Kalender"
                icon="chevron-back"
                onPress={onClose}
              />
            ) : undefined
          }
        />
        <ScreenScrollView
          surface="groupedBackground"
          testID="sharing-photo-viewport"
          onLayout={photos.onLayout}
          onScroll={photos.onScroll}
          scrollEventThrottle={100}
        >
          {mode === "overview" ? status : null}
          <AccountSyncNotice />
          {own
            .filter((calendar) => calendar.publicationPaused)
            .map((calendar) => (
              <SurfaceCard key={calendar.id}>
                <RowButton
                  title="Freigabe prüfen"
                  subtitle={own.length > 1 ? calendar.name : undefined}
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(async () => {
                      const preview = await controller.preparePublicationPreview(calendar.id);
                      setCalendarId(calendar.id);
                      setRecovery(preview);
                      setMode("recovery");
                    }, "Freigabe konnte nicht vorbereitet werden. Versuche es erneut.")
                  }
                />
              </SurfaceCard>
            ))}
          <View
            style={{ gap: SPACING.md }}
            testID="sharing-members-section"
            onLayout={photos.sectionLayout("members")}
          >
            <SectionHeader title="Personen mit Zugriff auf meinen Kalender" />
            {members.length ? (
              <View testID="sharing-members-card" onLayout={photos.cardLayout("members")}>
                <SurfaceCard>
                  {members.map(({ calendar, member }, index) => (
                    <View
                      key={`${calendar.id}:${member.userId}`}
                      testID={`sharing-member-${member.userId}`}
                      onLayout={photos.rowLayout("member:" + calendar.id + ":" + member.userId)}
                    >
                      {index ? <CardSeparator /> : null}
                      <RowButton
                        leading={
                          <PersonAvatar
                            name={member.displayName}
                            photoUri={sharedPersonPresentation(controller, member.userId).photoUri}
                            color={
                              sharedPersonPresentation(controller, member.userId).color ??
                              palette.primary
                            }
                          />
                        }
                        title={member.displayName}
                        subtitle={
                          member.status === "PENDING" ? `${calendar.name} · Anfrage` : calendar.name
                        }
                        accessibilityLabel={`Kalenderzugriff für ${member.displayName}`}
                        disabled={action.busy}
                        onPress={() =>
                          router.push({
                            pathname: "/calendar-access",
                            params: { calendarId: calendar.id, memberId: member.userId },
                          })
                        }
                      />
                    </View>
                  ))}
                </SurfaceCard>
              </View>
            ) : (
              <SharingParagraph>Noch niemand beigetreten.</SharingParagraph>
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
                  <SharingActiveInvitationCard
                    key={item.id}
                    title={link?.url ?? "Einladung"}
                    caption={
                      !link
                        ? item.rights
                          ? "Link auf dem ursprünglichen Gerät"
                          : "Einmal verwendbar · Link auf dem ursprünglichen Gerät"
                        : undefined
                    }
                    name={calendar.name}
                    remaining={invitationTimeRemaining(item.expiresAt, now)}
                    joined={
                      item.rights
                        ? `${item.joinedCount ?? 0} beigetreten`
                        : "0 beigetreten · einmal verwendbar"
                    }
                    busy={action.busy}
                    copyLabel={
                      controller.directCopyAvailable ? "Link kopieren" : "Link teilen oder kopieren"
                    }
                    onOpen={
                      link
                        ? () => {
                            setCalendarId(calendar.id);
                            setInvitation(link);
                            setMode("ready");
                          }
                        : undefined
                    }
                    onCopy={
                      link
                        ? () =>
                            void action.run(
                              () => controller.shareInvitation(link, "copy"),
                              controller.directCopyAvailable
                                ? "Link konnte nicht kopiert werden. Versuche es erneut."
                                : "Link konnte nicht geteilt werden. Versuche es erneut.",
                            )
                        : undefined
                    }
                    onStop={() =>
                      void action.run(
                        () => controller.revokeInvite(calendar.id, item.id),
                        "Einladung konnte nicht gestoppt werden. Versuche es erneut.",
                      )
                    }
                  />
                );
              })}
            </View>
          ) : null}
          <PrimaryButton disabled={action.busy} onPress={() => invite()}>
            Neue Einladung
          </PrimaryButton>
          {incoming.length ? (
            <View
              style={{ gap: SPACING.md }}
              testID="sharing-incoming-section"
              onLayout={photos.sectionLayout("incoming")}
            >
              <SectionHeader title="Mit dir geteilt" />
              <View testID="sharing-incoming-card" onLayout={photos.cardLayout("incoming")}>
                <SurfaceCard>
                  {incoming.map((calendar, index) => (
                    <View
                      key={calendar.id}
                      testID={`sharing-incoming-${calendar.id}`}
                      onLayout={photos.rowLayout("incoming:" + calendar.id)}
                    >
                      {index ? <CardSeparator /> : null}
                      <RowButton
                        title={calendar.name}
                        leading={
                          <SharingCalendarColorPicker
                            name={calendar.name}
                            value={calendar.color}
                            photoUri={
                              controller.profilePhotosAvailable ? calendar.profilePhotoUri : null
                            }
                            visible={calendar.visible}
                            disabled={action.busy}
                            onChange={(color) =>
                              void action.run(
                                () => controller.setColor(calendar.id, color),
                                "Farbe konnte nicht gespeichert werden. Versuche es erneut.",
                              )
                            }
                          />
                        }
                        trailing={
                          <LabeledSwitch
                            label={`${calendar.name} anzeigen`}
                            value={calendar.visible}
                            onValueChange={(on) => setCalendarVisible(calendar.id, on)}
                          />
                        }
                      />
                      {visibilityErrors.has(calendar.id) ? (
                        <SharingStatus
                          busy={false}
                          failed
                          message={visibilityErrors.get(calendar.id)}
                        />
                      ) : null}
                    </View>
                  ))}
                </SurfaceCard>
              </View>
            </View>
          ) : null}
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
                onPress={() =>
                  void action.run(
                    next,
                    "Einladung konnte nicht erstellt werden. Versuche es erneut.",
                  )
                }
              >
                Einladung erstellen
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
                {controller.contentRightsAvailable
                  ? "Wer den Link erhält, kann diese Inhalte ansehen, aber nicht bearbeiten."
                  : "Andere können diese Inhalte ansehen, aber nicht bearbeiten."}
              </SharingParagraph>
              <SurfaceCard>
                <RowButton
                  title="Profilbild teilen"
                  trailing={
                    <LabeledSwitch
                      label="Profilbild teilen"
                      value={shareProfilePhoto}
                      disabled={action.busy || !controller.profilePhotosAvailable}
                      onValueChange={setShareProfilePhoto}
                    />
                  }
                />
              </SurfaceCard>
              <SharingParagraph>
                Wer deiner Einladung folgt, sieht dann auch dein Kontofoto.
              </SharingParagraph>
              <SharingParagraph>
                Die ausgewählten Inhalte werden dafür online gespeichert.
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
                void action.run(
                  () => controller.shareInvitation(invitation, channel),
                  "Einladung konnte nicht geteilt werden. Versuche es erneut.",
                )
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
