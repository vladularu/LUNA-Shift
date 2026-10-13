import { useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import {
  CORNER_CURVE,
  MINIMUM_TOUCH_TARGET,
  RADII,
  SCREEN_LAYOUT,
  SHARED_CALENDAR_COLORS,
  SPACING,
} from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import {
  CardSeparator,
  ColorBadge,
  RowButton,
  SectionHeader,
  SurfaceCard,
} from "@/ui/design-system";
import { Field, PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { Text } from "@/ui/text";
import {
  SharingParagraph,
  SharingStatus,
  SharingUnavailableScreen,
  SignInActions,
  updateLabel,
  useSharingAction,
} from "./sharing-ui-elements";
import type {
  SharingCalendarView,
  SharingController,
  SharingPreview,
  SharingPublicationPreview,
  SharingVisibility,
} from "./sharing-ui-contract";

const COLORS = SHARED_CALENDAR_COLORS;
function calendarState(calendar: SharingCalendarView): string {
  const stamp = updateLabel(calendar.publishedAt);
  switch (calendar.syncState) {
    case "offline":
      return `Offline · Stand: ${stamp}`;
    case "expired":
      return "Offline-Daten abgelaufen. Bitte aktualisieren.";
    case "pending":
      return "Änderungen warten auf Übertragung";
    case "otherDevice":
      return "Veröffentlichung auf anderem Gerät";
    default:
      return `Stand: ${stamp}`;
  }
}
function confirm(title: string, message: string, label: string, action: () => void) {
  Alert.alert(title, message, [
    { text: "Abbrechen", style: "cancel" },
    { text: label, style: "destructive", onPress: action },
  ]);
}

function SafeSharingPreview({ preview }: { readonly preview: SharingPreview }) {
  return (
    <>
      <SectionHeader
        title="Das sehen eingeladene Personen"
        caption={`${preview.entryCount} Einträge`}
      />
      <SurfaceCard>
        {preview.entries.slice(0, 6).map((entry, index) => (
          <View key={`${index}-${entry.when}`}>
            <RowButton title={entry.title} subtitle={entry.when} />
            {index + 1 < Math.min(6, preview.entries.length) ? <CardSeparator /> : null}
          </View>
        ))}
        {preview.entryCount === 0 ? <RowButton title="Keine Einträge im Freigabebereich" /> : null}
      </SurfaceCard>
      <SharingParagraph>Notizen, Orte und Gehalt bleiben privat.</SharingParagraph>
      <SharingParagraph>
        Prüfe auch eigene Dienstnamen. Ausgewählte Termine erscheinen neutral als „Termin“.
      </SharingParagraph>
    </>
  );
}

export function CalendarSharingScreen({ controller }: { readonly controller: SharingController }) {
  const palette = usePalette();
  const action = useSharingAction(controller);
  const [mode, setMode] = useState<"overview" | "setup" | "preview" | "publishPreview" | "manage">(
    "overview",
  );
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [publicationPreview, setPublicationPreview] = useState<{
    readonly calendarId: string;
    readonly snapshot: SharingPublicationPreview;
  } | null>(null);
  const [name, setName] = useState("Mein Dienstplan");
  const [color, setColor] = useState<string>(COLORS[0].color);
  const [visibility, setVisibility] = useState<SharingVisibility>("DETAILS");
  const [appointmentIds, setAppointmentIds] = useState<readonly string[]>([]);
  const selected = controller.calendars.find((calendar) => calendar.id === calendarId);
  const status = <SharingStatus busy={action.busy} failed={action.failed} />;
  const back = (
    <SecondaryButton disabled={action.busy} onPress={() => setMode("overview")}>
      Zurück zur Übersicht
    </SecondaryButton>
  );

  if (controller.status === "loading")
    return <LoadingView label="Kalenderfreigaben werden geladen …" />;
  if (controller.status === "unavailable") return <SharingUnavailableScreen />;
  if (controller.status === "signedOut")
    return (
      <ScreenScrollView surface="groupedBackground">
        {status}
        <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>
            Deinen Dienstplan gemeinsam ansehen
          </Text>
          <SharingParagraph>
            Melde dich an, um deinen Kalender freizugeben oder eine Einladung anzunehmen.
          </SharingParagraph>
          <SharingParagraph>Dein Kalender bleibt ohne Konto nutzbar.</SharingParagraph>
        </SurfaceCard>
        <SignInActions controller={controller} run={action.run} busy={action.busy} />
        <SharingParagraph>
          Deine lokalen Daten werden erst nach deiner Bestätigung verbunden. Ein Konto ist noch kein
          vollständiges Cloud-Backup.
        </SharingParagraph>
      </ScreenScrollView>
    );

  const contentStyle = {
    gap: SPACING.xl,
    paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
    paddingTop: SPACING.md,
    paddingBottom: SCREEN_LAYOUT.contentBottomPadding,
  };
  const privacyControls = (
    <>
      <Field
        label="Kalendername"
        value={name}
        maxLength={64}
        editable={!action.busy}
        onChangeText={(value) => {
          setName(value);
          setMode("setup");
        }}
      />
      <View style={{ gap: SPACING.sm }}>
        <Text style={{ ...TYPOGRAPHY.label, color: palette.text }}>Kalenderfarbe</Text>
        <View style={{ flexDirection: "row", gap: SPACING.md, flexWrap: "wrap" }}>
          {COLORS.map((option) => (
            <Pressable
              key={option.color}
              accessibilityRole="radio"
              accessibilityLabel={option.name}
              accessibilityState={{ selected: color === option.color, disabled: action.busy }}
              disabled={action.busy}
              onPress={() => {
                setColor(option.color);
                setMode("setup");
              }}
              style={{
                minHeight: MINIMUM_TOUCH_TARGET,
                minWidth: MINIMUM_TOUCH_TARGET,
                padding: SPACING.xs,
                borderRadius: RADII.pill,
                borderCurve: CORNER_CURVE,
                borderWidth: 2,
                borderColor: color === option.color ? palette.text : "transparent",
              }}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: RADII.pill,
                  backgroundColor: option.color,
                }}
              />
            </Pressable>
          ))}
        </View>
      </View>
      <SurfaceCard>
        <RowButton
          title="Diensttypen und Zeiten"
          accessibilityLabel="Diensttypen und Zeiten"
          subtitle="Dienstnamen und Zeiten teilen. Vertrauliche Abwesenheiten bleiben neutral."
          disabled={action.busy}
          accessibilityState={{ selected: visibility === "DETAILS" }}
          trailing={
            <Text style={{ color: palette.text }}>{visibility === "DETAILS" ? "✓" : ""}</Text>
          }
          onPress={() => {
            setVisibility("DETAILS");
            setMode("setup");
          }}
        />
        <CardSeparator />
        <RowButton
          title="Nur Verfügbarkeit"
          accessibilityLabel="Nur Verfügbarkeit"
          subtitle="Alle Einträge erscheinen als „Nicht verfügbar“."
          disabled={action.busy}
          accessibilityState={{ selected: visibility === "AVAILABILITY" }}
          trailing={
            <Text style={{ color: palette.text }}>{visibility === "AVAILABILITY" ? "✓" : ""}</Text>
          }
          onPress={() => {
            setVisibility("AVAILABILITY");
            setMode("setup");
          }}
        />
      </SurfaceCard>
      <SharingParagraph>Termine bleiben privat.</SharingParagraph>
    </>
  );

  if (mode === "setup" || mode === "preview") {
    const preview = mode === "preview" ? controller.preview(visibility, appointmentIds) : null;
    const footer = (
      <View style={{ gap: SPACING.xl }}>
        {preview ? (
          <>
            <SafeSharingPreview preview={preview} />
            <PrimaryButton
              disabled={action.busy}
              onPress={() =>
                void action
                  .run(() =>
                    controller.createCalendar({
                      name: name.trim(),
                      color,
                      visibility,
                      confirmed: true,
                      ...(appointmentIds.length ? { selectedAppointmentIds: appointmentIds } : {}),
                    }),
                  )
                  .then((saved) => {
                    if (saved) setMode("overview");
                  })
              }
            >
              Diesen Dienstplan freigeben
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton
            disabled={action.busy || name.trim().length === 0}
            onPress={() => setMode("preview")}
          >
            Vorschau ansehen
          </PrimaryButton>
        )}
        {back}
      </View>
    );
    return (
      <FlatList
        data={controller.availableAppointments}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: palette.groupedBackground }}
        contentContainerStyle={contentStyle}
        ListHeaderComponent={
          <View style={{ gap: SPACING.xl }}>
            {status}
            <SectionHeader title="Eigenen Kalender freigeben" />
            {privacyControls}
            {controller.availableAppointments.length ? (
              <SectionHeader
                title="Termine auswählen"
                caption="Nur ausdrücklich ausgewählte Termine werden neutral geteilt."
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SurfaceCard>
            <RowButton
              title={item.title}
              subtitle={item.date}
              trailing={
                <LabeledSwitch
                  label={`${item.title} am ${item.date} freigeben`}
                  value={appointmentIds.includes(item.id)}
                  disabled={action.busy}
                  onValueChange={(value) => {
                    setAppointmentIds((ids) =>
                      value ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                    );
                    setMode("setup");
                  }}
                />
              }
            />
          </SurfaceCard>
        )}
        ListFooterComponent={footer}
      />
    );
  }

  if (
    mode === "publishPreview" &&
    selected?.isOwner &&
    selected.syncState !== "otherDevice" &&
    publicationPreview?.calendarId === selected.id
  ) {
    const calendar = selected;
    const preview = publicationPreview.snapshot;
    return (
      <ScreenScrollView surface="groupedBackground">
        {status}
        <SectionHeader title="Aktualisierung prüfen" caption={calendar.name} />
        <SafeSharingPreview preview={preview} />
        <SharingParagraph>
          Diese Freigabe ersetzt den bisher geteilten Stand. Erst nach deiner Bestätigung werden die
          aktuellen Dienste übertragen.
        </SharingParagraph>
        <PrimaryButton
          disabled={action.busy}
          onPress={() =>
            void action
              .run(() => controller.publishCalendar(calendar.id, preview.confirmationId))
              .then(() => {
                setPublicationPreview(null);
                setMode("manage");
              })
          }
        >
          Aktualisierung freigeben
        </PrimaryButton>
        <SecondaryButton
          disabled={action.busy}
          onPress={() => {
            setPublicationPreview(null);
            setMode("manage");
          }}
        >
          Abbrechen
        </SecondaryButton>
      </ScreenScrollView>
    );
  }

  if (mode === "manage" && selected) {
    const calendar = selected;
    const ownerControls = (
      <>
        <PrimaryButton
          disabled={action.busy}
          onPress={() => void action.run(() => controller.invite(calendar.id))}
        >
          Person einladen
        </PrimaryButton>
        <SharingParagraph>Einmal verwendbar · 7 Tage gültig</SharingParagraph>
        <SharingParagraph>
          Die Person fordert Zugriff an. Erst nach deiner Bestätigung kann sie den Kalender ansehen.
        </SharingParagraph>
        <SurfaceCard>
          <RowButton
            title="Dienstplan aktualisieren"
            subtitle={calendarState(calendar)}
            disabled={action.busy || calendar.syncState === "otherDevice"}
            onPress={() =>
              void action.run(async () => {
                const snapshot = await controller.preparePublicationPreview(calendar.id);
                setPublicationPreview({ calendarId: calendar.id, snapshot });
                setMode("publishPreview");
              })
            }
          />
        </SurfaceCard>
        {calendar.invites
          .filter((invite) => !invite.consumedAt && !invite.revokedAt)
          .map((invite) => (
            <SurfaceCard key={invite.id}>
              <RowButton
                title="Offene Einladung"
                subtitle={`Gültig bis ${updateLabel(invite.expiresAt)}`}
              />
              <CardSeparator />
              <RowButton
                title="Einladung widerrufen"
                disabled={action.busy}
                destructive
                onPress={() =>
                  void action.run(() => controller.revokeInvite(calendar.id, invite.id))
                }
              />
            </SurfaceCard>
          ))}
        <SectionHeader title="Personen mit Zugriff" />
      </>
    );
    const footer = (
      <View style={{ gap: SPACING.xl }}>
        <SharingParagraph>
          Empfänger können nur ansehen. Bereits gelesene oder offline gespeicherte Angaben lassen
          sich nicht sofort zurückholen.
        </SharingParagraph>
        <SurfaceCard>
          {calendar.isOwner ? (
            <RowButton
              title="Freigabe löschen"
              disabled={action.busy}
              destructive
              onPress={() =>
                confirm(
                  "Freigabe löschen?",
                  "Der geteilte Kalender und alle Zugriffe werden gelöscht. Deine lokalen Dienste bleiben erhalten.",
                  "Freigabe löschen",
                  () =>
                    void action
                      .run(() => controller.deleteCalendar(calendar.id))
                      .then((saved) => {
                        if (saved) setMode("overview");
                      }),
                )
              }
            />
          ) : (
            <RowButton
              title="Kalender verlassen"
              disabled={action.busy}
              destructive
              onPress={() =>
                confirm(
                  "Kalender verlassen?",
                  "Der fremde Kalender wird von diesem Gerät entfernt. Deine eigenen Dienste bleiben erhalten.",
                  "Verlassen",
                  () =>
                    void action
                      .run(() => controller.leaveCalendar(calendar.id))
                      .then((saved) => {
                        if (saved) setMode("overview");
                      }),
                )
              }
            />
          )}
        </SurfaceCard>
        {back}
      </View>
    );
    const members = calendar.isOwner
      ? calendar.members.filter(
          (member) => member.status === "PENDING" || member.status === "ACTIVE",
        )
      : [];
    return (
      <FlatList
        data={members}
        keyExtractor={(member) => member.userId}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={contentStyle}
        style={{ backgroundColor: palette.groupedBackground }}
        ListHeaderComponent={
          <View style={{ gap: SPACING.xl }}>
            {status}
            <SectionHeader
              title={calendar.name}
              caption={calendar.isOwner ? "Deine Freigabe" : "Nur ansehen"}
            />
            {calendar.isOwner ? (
              ownerControls
            ) : (
              <SharingParagraph>{calendarState(calendar)}</SharingParagraph>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <SurfaceCard>
            <RowButton
              title={item.displayName}
              subtitle={
                item.status === "PENDING" ? "Wartet auf Bestätigung" : "Kann den Kalender ansehen"
              }
            />
            {item.status === "PENDING" ? (
              <>
                <CardSeparator />
                <RowButton
                  title="Bestätigen"
                  accessibilityLabel={`${item.displayName} bestätigen`}
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(() => controller.setMember(calendar.id, item.userId, "APPROVE"))
                  }
                />
                <CardSeparator />
                <RowButton
                  title="Ablehnen"
                  accessibilityLabel={`${item.displayName} ablehnen`}
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(() => controller.setMember(calendar.id, item.userId, "REJECT"))
                  }
                />
              </>
            ) : (
              <>
                <CardSeparator />
                <RowButton
                  title="Zugriff entfernen"
                  accessibilityLabel={`Zugriff für ${item.displayName} entfernen`}
                  disabled={action.busy}
                  destructive
                  onPress={() =>
                    confirm(
                      "Zugriff entfernen?",
                      "Diese Person kann den Kalender künftig nicht mehr abrufen.",
                      "Entfernen",
                      () =>
                        void action.run(() =>
                          controller.setMember(calendar.id, item.userId, "REVOKE"),
                        ),
                    )
                  }
                />
              </>
            )}
          </SurfaceCard>
        )}
        ListEmptyComponent={
          calendar.isOwner ? (
            <SharingParagraph>Noch keine Personen mit Zugriff.</SharingParagraph>
          ) : null
        }
        ListFooterComponent={footer}
      />
    );
  }

  return (
    <FlatList
      data={controller.calendars}
      keyExtractor={(calendar) => calendar.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: palette.groupedBackground }}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={
        <View style={{ gap: SPACING.xl }}>
          {status}
          <SharingParagraph>{`Angemeldet als ${controller.account?.displayName ?? "LUNA Nutzer"}`}</SharingParagraph>
          <PrimaryButton
            disabled={action.busy}
            onPress={() => {
              setAppointmentIds([]);
              setMode("setup");
            }}
          >
            Eigenen Kalender teilen
          </PrimaryButton>
          <SectionHeader title="Deine Kalender" />
          <SharingParagraph>
            Jeder bearbeitet seinen eigenen Dienstplan. Fremde Kalender verändern keine Auswertung.
          </SharingParagraph>
        </View>
      }
      renderItem={({ item }) => (
        <SurfaceCard>
          <RowButton
            title={item.name}
            subtitle={`${item.isOwner ? "Deine Freigabe" : "Nur ansehen"} · ${calendarState(item)}`}
            subtitleBelow
            leading={<ColorBadge color={item.color} label={item.name} size={32} />}
            trailing={
              item.isOwner ? null : (
                <LabeledSwitch
                  label={`${item.name} im Kalender anzeigen`}
                  value={item.visible}
                  disabled={action.busy}
                  onValueChange={(value) =>
                    void action.run(() => controller.setVisible(item.id, value))
                  }
                />
              )
            }
          />
          <CardSeparator />
          <RowButton
            title="Freigabe verwalten"
            accessibilityLabel={`${item.name} verwalten`}
            disabled={action.busy}
            onPress={() => {
              setCalendarId(item.id);
              setMode("manage");
            }}
          />
        </SurfaceCard>
      )}
      ListEmptyComponent={
        <SurfaceCard>
          <RowButton
            title="Noch keine Kalenderfreigaben"
            subtitle="Teile deinen Plan oder öffne den Einladungslink einer anderen Person."
          />
        </SurfaceCard>
      }
      ListFooterComponent={
        <View style={{ gap: SPACING.xl }}>
          <SurfaceCard>
            <RowButton
              title="Aktualisieren"
              disabled={action.busy}
              onPress={() => void action.run(() => controller.refresh())}
            />
            <CardSeparator />
            <RowButton
              title="Abmelden"
              disabled={action.busy}
              onPress={() =>
                confirm(
                  "Abmelden?",
                  "Fremde Kalender werden entfernt. Deine lokalen Dienste und Einstellungen bleiben erhalten.",
                  "Abmelden",
                  () => void action.run(() => controller.signOut()),
                )
              }
            />
            <CardSeparator />
            <RowButton
              title="Konto löschen"
              disabled={action.busy || !controller.accountDeletionAvailable}
              destructive
              subtitle={
                !controller.accountDeletionAvailable
                  ? "Derzeit nicht verfügbar. Bitte versuche es später erneut."
                  : undefined
              }
              onPress={() =>
                confirm(
                  "Konto dauerhaft löschen?",
                  "Dein Konto, eigene Freigaben und Mitgliedschaften werden dauerhaft gelöscht. Deine lokalen Dienste und Einstellungen bleiben erhalten.",
                  "Konto löschen",
                  () => void action.run(() => controller.deleteAccount()),
                )
              }
            />
          </SurfaceCard>
          <SharingParagraph>
            Kontolöschung betrifft die Cloud. Deine lokalen Daten bleiben auf diesem Gerät.
          </SharingParagraph>
        </View>
      }
    />
  );
}
