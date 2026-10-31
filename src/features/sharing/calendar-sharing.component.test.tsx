import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { CalendarAccessScreen } from "./calendar-access-screen";
import { render, controller, own, foreign, confirmLastAlert } from "@/testing/sharing-fixtures";
import { SharingInviteScreen } from "./sharing-invite-screen";
import type { SharingController } from "./sharing-ui-contract";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

beforeEach(() => {
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
function MemberAccess({
  controller,
  memberId = "active",
  calendarId = "own",
}: {
  readonly controller: SharingController;
  readonly memberId?: string;
  readonly calendarId?: string;
}) {
  return (
    <CalendarAccessScreen
      controller={controller}
      memberId={memberId}
      calendarId={calendarId}
      onBack={() => {}}
    />
  );
}

describe("Kalenderfreigabe", () => {
  it("describes a pending person as waiting until approval and updates with their actual status", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<MemberAccess memberId="pending" controller={c} />);
    expect(screen.getByText("Erst nach deiner Bestätigung sichtbar.")).toBeTruthy();
    expect(c.setMember).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff erlauben" }));
    expect(c.setMember).toHaveBeenCalledWith("own", "pending", "APPROVE");
    await screen.rerender(
      <MemberAccess
        memberId="pending"
        controller={{
          ...c,
          calendars: [
            { ...own, members: own.members.map((member) => ({ ...member, status: "ACTIVE" })) },
          ],
        }}
      />,
    );
    expect(screen.getByText("Nur ansehen. Bearbeiten ist nicht erlaubt.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zugriff erlauben" })).toBeNull();
  });
  it("does not mistake an existing invitation for a person who has joined", async () => {
    const c = controller({ calendars: [{ ...own, members: [] }] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Aktive Einladungslinks")).toBeTruthy();
    expect(screen.getByText("Noch niemand beigetreten.")).toBeTruthy();
    expect(c.createInvitation).not.toHaveBeenCalled();
  });
  it("explains online storage before the explicit creation action and reports a safe invitation error", async () => {
    const c = controller({
      contentRightsAvailable: true,
      createInvitation: jest
        .fn<SharingController["createInvitation"]>()
        .mockRejectedValue(new Error("private token=secret")),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(
      screen.getByText("Die ausgewählten Inhalte werden dafür online gespeichert."),
    ).toBeTruthy();
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createInvitation).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Einladung konnte nicht erstellt werden. Versuche es erneut."),
    ).toBeTruthy();
    expect(screen.queryByText(/private token=secret/)).toBeNull();
    expect(c.shareInvitation).not.toHaveBeenCalled();
  });
  it("keeps account management in LUNA Cloud and removes the lower sharing card", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.queryByRole("button", { name: "Konto" })).toBeNull();
    expect(screen.queryByText("Freigabe verwalten")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mein Dienstplan verwalten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Freigabeaktionen" })).toBeNull();
    expect(screen.queryByText("Freigabe für alle beenden")).toBeNull();
    expect(c.signOut).not.toHaveBeenCalled();
    expect(c.deleteAccount).not.toHaveBeenCalled();
  });
  it("keeps individual access controls for multiple calendars without a global menu", async () => {
    const c = controller({
      calendars: [own, { ...own, id: "second", name: "Zweiter Plan", invites: [] }],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.queryByRole("button", { name: "Freigabeaktionen" })).toBeNull();
    await fireEvent.press(screen.getAllByRole("button", { name: "Kalenderzugriff für Kim" })[1]);
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/calendar-access",
      params: { calendarId: "second", memberId: "active" },
    });
    await screen.rerender(<MemberAccess controller={c} calendarId="second" />);
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff entfernen" }));
    expect(c.deleteCalendar).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(c.setMember).toHaveBeenCalledWith("second", "active", "REVOKE");
    expect(c.deleteCalendar).not.toHaveBeenCalled();
  });
  it("reopens a persisted multi-use invitation and displays its actual join count", async () => {
    const invitation = {
      calendarId: "own",
      id: "invite",
      url: "https://luna.example/sharing-invite?token=" + "b".repeat(64),
      expiresAt: "2099-10-19T12:30:00Z",
    };
    const c = controller({
      contentRightsAvailable: true,
      issuedInvitations: [invitation],
      calendars: [
        {
          ...own,
          invites: own.invites.map((invite) => ({
            ...invite,
            joinedCount: 2,
            rights: { shifts: true, appointments: false, notes: false },
          })),
        },
      ],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("2 beigetreten")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung öffnen" }));
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    expect(c.createInvitation).not.toHaveBeenCalled();
  });
  it("creates an appointments-only invitation even before the first appointment is entered", async () => {
    const c = controller({ contentRightsAvailable: true });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByRole("button", { name: "Schichten teilen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Termine teilen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ rights: { shifts: false, appointments: true, notes: false } }),
    );
    expect(c.createInvitation).toHaveBeenCalledWith("own", {
      shifts: false,
      appointments: true,
      notes: false,
    });
    await screen.rerender(<CalendarSharingScreen controller={{ ...c, calendars: [own] }} />);
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
  });
  it("keeps notes off initially and passes the explicit switch selection to the invitation", async () => {
    const c = controller({ calendars: [own], contentRightsAvailable: true });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(
      screen.getByRole("switch", { name: "Notizen teilen" }).props.accessibilityState.checked,
    ).toBe(false);
    await fireEvent(screen.getByRole("switch", { name: "Notizen teilen" }), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).toHaveBeenCalledWith("own", {
      shifts: true,
      appointments: false,
      notes: true,
    });
  });
  it("offers photo sharing off by default in each new invitation and sends explicit consent", async () => {
    const c = controller({
      calendars: [own],
      contentRightsAvailable: true,
      profilePhotosAvailable: true,
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(
      screen.getByRole("switch", { name: "Profilbild teilen" }).props.accessibilityState.checked,
    ).toBe(false);
    await fireEvent(screen.getByRole("switch", { name: "Profilbild teilen" }), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createInvitation).toHaveBeenCalledWith(
      "own",
      { shifts: true, appointments: false, notes: false },
      true,
    );
  });
  it("edits photo consent only for the selected recipient in Kalenderzugriff", async () => {
    const setMemberProfilePhoto = jest
      .fn<NonNullable<SharingController["setMemberProfilePhoto"]>>()
      .mockResolvedValue();
    const c = controller({ calendars: [own], profilePhotosAvailable: true, setMemberProfilePhoto });
    const screen = await render(<MemberAccess controller={c} />);
    expect(
      screen.getByRole("switch", { name: "Profilbild teilen" }).props.accessibilityState.checked,
    ).toBe(false);
    await fireEvent(screen.getByRole("switch", { name: "Profilbild teilen" }), "valueChange", true);
    expect(setMemberProfilePhoto).toHaveBeenCalledWith("own", "active", true);
    expect(c.setMember).not.toHaveBeenCalled();
    await screen.rerender(
      <MemberAccess
        controller={{
          ...c,
          calendars: [
            { ...own, members: own.members.map((m) => ({ ...m, shareProfilePhoto: true })) },
          ],
        }}
      />,
    );
    await fireEvent(
      screen.getByRole("switch", { name: "Profilbild teilen" }),
      "valueChange",
      false,
    );
    expect(setMemberProfilePhoto).toHaveBeenLastCalledWith("own", "active", false);
  });
  it("disables photo consent when the server does not support it", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(screen.getByRole("switch", { name: "Profilbild teilen" })).toBeDisabled();
  });
  it("changes only the selected person's content rights", async () => {
    const setMemberRights = jest
      .fn<NonNullable<SharingController["setMemberRights"]>>()
      .mockResolvedValue();
    const c = controller({
      contentRightsAvailable: true,
      setMemberRights,
      calendars: [
        {
          ...own,
          members: own.members.map((member) => ({
            ...member,
            rights: { shifts: true, appointments: false, notes: false },
          })),
        },
      ],
    });
    const screen = await render(<MemberAccess controller={c} />);
    await fireEvent(screen.getByRole("switch", { name: "Notizen freigeben" }), "valueChange", true);
    expect(setMemberRights).toHaveBeenCalledWith("own", "active", {
      shifts: true,
      appointments: false,
      notes: true,
    });
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.setMember).not.toHaveBeenCalled();
  });
  it("opens the selected person directly and revokes only that person's access", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<MemberAccess controller={c} />);
    expect(screen.getByTestId("back-footer-surface")).toBeTruthy();
    expect(screen.getByText("Kim")).toBeTruthy();
    expect(screen.queryByText("Sam")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff entfernen" }));
    expect(c.setMember).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(c.setMember).toHaveBeenCalledWith("own", "active", "REVOKE");
    expect(c.deleteCalendar).not.toHaveBeenCalled();
  });
  it.each([
    { state: "before the first invitation", calendars: [] },
    { state: "with an existing calendar and invitation", calendars: [own] },
  ])(
    "has one invitation entry and cancels without creating anything $state",
    async ({ calendars }) => {
      const c = controller({ calendars });
      const screen = await render(<CalendarSharingScreen controller={c} />);
      expect(
        screen.getAllByRole("button", { name: /^Neue Einladung(?: erstellen)?$/ }),
      ).toHaveLength(1);
      await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
      expect(c.createCalendar).not.toHaveBeenCalled();
      expect(c.createInvitation).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Einladung schließen" }));
      expect(
        screen.getAllByRole("button", { name: /^Neue Einladung(?: erstellen)?$/ }),
      ).toHaveLength(1);
      expect(c.createCalendar).not.toHaveBeenCalled();
      expect(c.createInvitation).not.toHaveBeenCalled();
      expect(c.shareInvitation).not.toHaveBeenCalled();
    },
  );
  it("retains the issued link on the overview and can reopen the same QR without another invitation", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung schließen" }));
    expect(screen.getByText("Aktive Einladungslinks")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung öffnen" }));
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    expect(c.createInvitation).toHaveBeenCalledTimes(1);
  });
  it("does not require manual publication for ordinary pending changes", async () => {
    const c = controller({ calendars: [{ ...own, syncState: "pending" }] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.queryByText("Freigabe prüfen")).toBeNull();
    expect(c.preparePublicationPreview).not.toHaveBeenCalled();
  });
  it("hides an open QR when the invitation is consumed", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByText("Einladung erstellen"));
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    await screen.rerender(
      <CalendarSharingScreen
        controller={{
          ...c,
          calendars: [
            { ...own, invites: [{ ...own.invites[0], consumedAt: "2026-10-13T12:00:00Z" }] },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId("sharing-qr")).toBeNull();
    expect(screen.queryByText("Einladung teilen")).toBeNull();
    expect(screen.getByText("Neue Einladung")).toBeTruthy();
  });
  it("retries a failed invitation without creating another calendar", async () => {
    const c = controller();
    jest.mocked(c.createInvitation).mockRejectedValueOnce(new Error("offline"));
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByText("Einladung erstellen"));
    expect(screen.getByRole("button", { name: "Einladung erstellen" })).toBeTruthy();
    expect(c.shareInvitation).not.toHaveBeenCalled();
    await screen.rerender(<CalendarSharingScreen controller={{ ...c, calendars: [own] }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createCalendar).toHaveBeenCalledTimes(1);
    expect(c.createInvitation).toHaveBeenCalledTimes(2);
    expect(c.createInvitation).toHaveBeenLastCalledWith("own");
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung schließen" }));
    expect(screen.getAllByRole("button", { name: /^Neue Einladung(?: erstellen)?$/ })).toHaveLength(
      1,
    );
  });

  it("keeps login optional and only starts a provider after pressing its action", async () => {
    const c = controller({ status: "signedOut", account: null });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Gemeinsam planen")).toBeTruthy();
    expect(c.signIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Mit LUNA-Konto anmelden" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Mit Apple fortfahren" }));
    expect(c.signIn).toHaveBeenCalledWith("apple");
    await fireEvent.press(screen.getByRole("button", { name: "Mit Google fortfahren" }));
    expect(c.signIn).toHaveBeenCalledWith("google");
  });
  it("does not offer fake login when cloud setup is unavailable", async () => {
    const c = controller({ status: "unavailable", account: null });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Kalenderfreigaben sind noch nicht eingerichtet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mit Google fortfahren" })).toBeNull();
    expect(c.createCalendar).not.toHaveBeenCalled();
  });
  it("requires selecting contents before creating a full-details invitation", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(screen.getByText("Was möchtest du teilen?")).toBeTruthy();
    expect(screen.queryByText("Nur Verfügbarkeit")).toBeNull();
    expect(screen.queryByLabelText("Name im geteilten Kalender")).toBeNull();
    expect(screen.getByLabelText("Notizen teilen")).toBeDisabled();
    expect(c.createCalendar).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Schichten teilen" }));
    expect(screen.getByRole("button", { name: "Einladung erstellen" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Schichten teilen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createCalendar).toHaveBeenCalledWith({
      name: "Alex",
      color: "#527D92",
      visibility: "DETAILS",
      confirmed: true,
      selectedAppointmentIds: [],
    });
  });
  it("keeps an existing invitation behind the same two-step flow and puts QR next to delivery options", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(c.createInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung erstellen" }));
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).toHaveBeenCalledWith("own");
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    expect(screen.getByText("QR-Code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einladung teilen" })).toBeTruthy();
    for (const name of [
      "Mit Nachrichten einladen",
      "Mit WhatsApp einladen",
      "Mit Telegram einladen",
      "Mit E-Mail einladen",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText("Oder per QR-Code teilen")).toBeNull();
    expect(c.shareInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung teilen" }));
    expect(c.shareInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "invite" }),
      "system",
    );
  });
  it("lets readers hide a calendar without exposing owner actions", async () => {
    const c = controller({ calendars: [foreign] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent(screen.getByLabelText("Sams Plan anzeigen"), "valueChange", false);
    expect(c.setVisible).toHaveBeenCalledWith("foreign", false);
    expect(screen.queryByRole("button", { name: "Optionen für Sams Plan" })).toBeNull();
    expect(screen.queryByText("Kalender verlassen")).toBeNull();
    expect(screen.queryByText("Freigabe für alle beenden")).toBeNull();
    expect(c.leaveCalendar).not.toHaveBeenCalled();
  });
  it("requires a fresh safe preview before any manual update and cancellation publishes nothing", async () => {
    const c = controller({
      calendars: [
        {
          ...own,
          syncState: "pending",
          publicationPaused: true,
          selectedAppointmentIds: ["consented-appointment"],
        },
      ],
      preparePublicationPreview: jest
        .fn<SharingController["preparePublicationPreview"]>()
        .mockResolvedValue({
          confirmationId: "confirmation",
          entryCount: 2,
          entries: [
            { title: "Nacht", when: "24.10. · 21:00–07:30 · Folgetag" },
            { title: "Termin", when: "25.10. · 12:00–13:00" },
          ],
        }),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Freigabe prüfen"));
    expect(c.publishCalendar).not.toHaveBeenCalled();
    expect(c.preparePublicationPreview).toHaveBeenCalledWith("own");
    expect(screen.getByRole("button", { name: "Freigabe fortsetzen" })).toBeTruthy();
    expect(screen.getByText("24.10. · 21:00–07:30 · Folgetag")).toBeTruthy();
    expect(screen.getByText("Termin")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(c.publishCalendar).not.toHaveBeenCalled();
    expect(screen.getByText("Freigabe prüfen")).toBeTruthy();
  });
  it("previews a restore-cleared appointment selection and only publishes the selected calendar on confirmation", async () => {
    const c = controller({
      calendars: [
        { ...own, syncState: "pending", publicationPaused: true, selectedAppointmentIds: [] },
      ],
      availableAppointments: [
        { id: "restored", title: "Private restored appointment", date: "25.10." },
      ],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Freigabe prüfen"));
    expect(c.preparePublicationPreview).toHaveBeenCalledWith("own");
    expect(screen.queryByText("Private restored appointment")).toBeNull();
    expect(c.publishCalendar).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Freigabe fortsetzen" }));
    expect(c.publishCalendar).toHaveBeenCalledTimes(1);
    expect(c.publishCalendar).toHaveBeenCalledWith("own", "confirmation");
    expect(screen.getByText("Freigabe prüfen")).toBeTruthy();
  });
  it("requires a new local preparation after a confirmed preview becomes stale", async () => {
    const c = controller({
      calendars: [{ ...own, syncState: "pending", publicationPaused: true }],
      publishCalendar: jest
        .fn<SharingController["publishCalendar"]>()
        .mockRejectedValue(new Error("SHARE_PREVIEW_STALE")),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Freigabe prüfen"));
    await fireEvent.press(screen.getByRole("button", { name: "Freigabe fortsetzen" }));
    expect(screen.queryByText("Freigabe fortsetzen")).toBeNull();
    expect(screen.getByText("Freigabe prüfen")).toBeTruthy();
    expect(screen.queryByText("SHARE_PREVIEW_STALE")).toBeNull();
    await fireEvent.press(screen.getByText("Freigabe prüfen"));
    expect(c.preparePublicationPreview).toHaveBeenCalledTimes(2);
    expect(c.publishCalendar).toHaveBeenCalledTimes(1);
  });
  it("opens OS sharing only through the explicit invitation action", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(c.invite).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(c.createInvitation).not.toHaveBeenCalled();
    expect(c.shareInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Einladung erstellen"));
    await fireEvent.press(screen.getByText("Einladung teilen"));
    expect(c.shareInvitation).toHaveBeenCalledTimes(1);
  });
  it("distinguishes requesting members and active readers with explicit control", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<MemberAccess memberId="pending" controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff erlauben" }));
    expect(c.setMember).toHaveBeenCalledWith("own", "pending", "APPROVE");
    await fireEvent.press(screen.getByRole("button", { name: "Anfrage ablehnen" }));
    expect(c.setMember).toHaveBeenCalledWith("own", "pending", "REJECT");
    await screen.rerender(<MemberAccess controller={c} memberId="active" />);
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff entfernen" }));
    await confirmLastAlert();
    expect(c.setMember).toHaveBeenCalledWith("own", "active", "REVOKE");
  });
  it("stops an invitation without exposing a calendar-wide stop", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Einladung stoppen" }));
    expect(c.revokeInvite).toHaveBeenCalledWith("own", "invite");
    expect(screen.queryByRole("button", { name: "Freigabeaktionen" })).toBeNull();
    expect(screen.queryByText("Freigabe für alle beenden")).toBeNull();
    expect(c.deleteCalendar).not.toHaveBeenCalled();
  });
  it("keeps individual access until its explicit destructive confirmation", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<MemberAccess controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff entfernen" }));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[0]).toEqual({
      text: "Abbrechen",
      style: "cancel",
    });
    expect(c.deleteCalendar).not.toHaveBeenCalled();
    expect(c.setMember).not.toHaveBeenCalled();
  });
  it("never renders a backend error message or private account email", async () => {
    const c = controller({ error: true, busy: true, calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(
      screen.getByText("Freigaben konnten nicht aktualisiert werden. Versuche es erneut."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neue Einladung" })).toBeDisabled();
    expect(screen.queryByText(/SHARE_|token|apikey/)).toBeNull();
  });
});

describe("Einladung", () => {
  const token = "a".repeat(64);
  it("does not consume a link by rendering it and requires a named explicit request", async () => {
    const c = controller();
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    expect(c.claimInvite).not.toHaveBeenCalled();
    expect(screen.queryByText(token)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(c.claimInvite).toHaveBeenCalledWith(token, "Alex");
  });
  it("rejects malformed or duplicate tokens without invoking any backend action", async () => {
    const c = controller();
    const screen = await render(<SharingInviteScreen controller={c} token={[token, token]} />);
    expect(screen.getByText("Dieser Einladungslink ist ungültig.")).toBeTruthy();
    expect(screen.queryByText("Einladung annehmen")).toBeNull();
    expect(c.claimInvite).not.toHaveBeenCalled();
  });
  it("lets signed-out recipients sign in before explicitly requesting access", async () => {
    const c = controller({ status: "signedOut", account: null });
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    expect(screen.queryByText("Einladung annehmen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Mit Google fortfahren" }));
    expect(c.signIn).toHaveBeenCalledWith("google");
    expect(c.claimInvite).not.toHaveBeenCalled();
  });
  it("shows pending approval without claiming again on rerender", async () => {
    const c = controller({ claimResult: { calendarName: "Sams Plan", status: "PENDING" } });
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    await fireEvent.press(screen.getByText("Einladung annehmen"));
    expect(screen.getByText("Anfrage gesendet")).toBeTruthy();
    expect(screen.getByText("Sams Plan")).toBeTruthy();
    expect(screen.queryByText("Einladung annehmen")).toBeNull();
    await screen.rerender(<SharingInviteScreen controller={c} token={token} />);
    expect(c.claimInvite).toHaveBeenCalledTimes(1);
  });
});

it("changes only the selected received calendar color directly from the overview", async () => {
  const c = controller({ calendars: [foreign, { ...foreign, id: "second", name: "Alexs Plan" }] });
  const screen = await render(
    <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <CalendarSharingScreen controller={c} />
    </SafeAreaInsetsContext.Provider>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Farbe für Sams Plan" }), {
    stopPropagation: jest.fn(),
  });
  const swatch = screen.getAllByRole("button", { name: /^Farbe #/ })[0];
  const color = swatch.props.accessibilityLabel.slice("Farbe ".length);
  await fireEvent.press(swatch);
  expect(c.setColor).toHaveBeenCalledWith("foreign", color);
  expect(screen.getByText("Mit dir geteilt")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Farbe für Alexs Plan" }), {
    stopPropagation: jest.fn(),
  });
  await fireEvent.press(screen.getAllByRole("button", { name: /^Farbe #/ })[0]);
  expect(c.setColor).toHaveBeenLastCalledWith("second", color);
  expect(c.deleteCalendar).not.toHaveBeenCalled();
});

it("keeps visibility switches enabled and the page free of a global spinner during a local write", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const c = controller({
    calendars: [foreign],
    setVisible: jest.fn<SharingController["setVisible"]>().mockReturnValue(pending),
  });
  const screen = await render(<CalendarSharingScreen controller={c} />);
  const toggle = screen.getByLabelText("Sams Plan anzeigen");
  await fireEvent(toggle, "valueChange", false);
  expect(screen.queryByText("Wird bearbeitet")).toBeNull();
  expect(screen.getByLabelText("Sams Plan anzeigen").props.accessibilityState?.disabled).not.toBe(
    true,
  );
  await fireEvent(screen.getByLabelText("Sams Plan anzeigen"), "valueChange", true);
  expect(c.setVisible).toHaveBeenCalledTimes(2);
  await act(async () => resolve());
});

it("opens member access as its own stack route and keeps the overview mounted", async () => {
  const c = controller({ calendars: [own] });
  const screen = await render(<CalendarSharingScreen controller={c} />);
  await fireEvent.press(screen.getByRole("button", { name: "Kalenderzugriff für Kim" }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/calendar-access",
    params: { calendarId: "own", memberId: "active" },
  });
  expect(screen.getByRole("button", { name: "Neue Einladung" })).toBeTruthy();
});
