import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { SharingInviteScreen } from "./sharing-invite-screen";
import type { SharingCalendarView, SharingController } from "./sharing-ui-contract";

function controller(overrides: Partial<SharingController> = {}): SharingController {
  const action = () => jest.fn<() => Promise<void>>().mockResolvedValue();
  return {
    status: "signedIn",
    account: { displayName: "Alex" },
    busy: false,
    error: false,
    calendars: [],
    availableAppointments: [],
    claimResult: null,
    appleAvailable: true,
    accountDeletionAvailable: true,
    preview: jest.fn(() => ({
      entryCount: 1,
      entries: [{ title: "Spät", when: "12.10. · 13:00–21:00" }],
    })),
    signIn: action(),
    refresh: action(),
    createCalendar: jest.fn<SharingController["createCalendar"]>().mockResolvedValue("own"),
    createInvitation: jest.fn<SharingController["createInvitation"]>().mockResolvedValue({
      calendarId: "own",
      id: "invite",
      url: "https://luna.example/sharing-invite?token=" + "b".repeat(64),
      expiresAt: "2099-10-19T12:30:00Z",
    }),
    shareInvitation: action(),
    preparePublicationPreview: jest
      .fn<SharingController["preparePublicationPreview"]>()
      .mockResolvedValue({
        confirmationId: "confirmation",
        entryCount: 1,
        entries: [{ title: "Spät", when: "12.10. · 13:00–21:00" }],
      }),
    publishCalendar: action(),
    setVisible: action(),
    setColor: action(),
    invite: action(),
    setMember: action(),
    revokeInvite: action(),
    deleteCalendar: action(),
    leaveCalendar: action(),
    claimInvite: action(),
    signOut: action(),
    deleteAccount: action(),
    ...overrides,
  };
}
const own: SharingCalendarView = {
  id: "own",
  name: "Mein Dienstplan",
  color: "#527D92",
  visibility: "DETAILS",
  isOwner: true,
  visible: true,
  publishedAt: "2026-10-12T12:30:00Z",
  syncState: "current",
  members: [
    { userId: "pending", displayName: "Sam", status: "PENDING" },
    { userId: "active", displayName: "Kim", status: "ACTIVE" },
  ],
  invites: [{ id: "invite", expiresAt: "2099-10-19T12:30:00Z", consumedAt: null, revokedAt: null }],
};
const foreign: SharingCalendarView = {
  ...own,
  id: "foreign",
  name: "Sams Plan",
  isOwner: false,
  members: [],
  invites: [],
};
beforeEach(() => {
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
async function confirmLastAlert() {
  const calls = jest.mocked(Alert.alert).mock.calls;
  const buttons = calls[calls.length - 1][2];
  await act(async () => buttons?.find((button) => button.style === "destructive")?.onPress?.());
}

describe("Kalenderfreigabe", () => {
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
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).toHaveBeenCalledWith("own", {
      shifts: true,
      appointments: false,
      notes: true,
    });
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
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderzugriff für Kim" }));
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
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Kalenderzugriff für Kim" }));
    expect(screen.getByText("Kalenderzugriff")).toBeTruthy();
    expect(screen.getByText("Kim")).toBeTruthy();
    expect(screen.queryByText("Sam")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Freigabe beenden" }));
    expect(c.setMember).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(c.setMember).toHaveBeenCalledWith("own", "active", "REVOKE");
    expect(c.deleteCalendar).not.toHaveBeenCalled();
  });
  it("closes the selection without creating a calendar or an invitation", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung erstellen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung schließen" }));
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).not.toHaveBeenCalled();
    expect(c.shareInvitation).not.toHaveBeenCalled();
  });
  it("retains the issued link on the overview and can reopen the same QR without another invitation", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung schließen" }));
    expect(screen.getByText("Aktive Einladungslinks")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung öffnen" }));
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    expect(c.createInvitation).toHaveBeenCalledTimes(1);
  });
  it("does not require manual publication for ordinary pending changes", async () => {
    const c = controller({ calendars: [{ ...own, syncState: "pending" }] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    expect(screen.queryByText("Freigabe prüfen")).toBeNull();
    expect(c.preparePublicationPreview).not.toHaveBeenCalled();
  });
  it("hides an open QR when the invitation is consumed", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByText("Weiter"));
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
    expect(screen.queryByText("Sonstige")).toBeNull();
    expect(screen.getByText("Neue Einladung")).toBeTruthy();
  });
  it("retries a failed invitation without creating another calendar", async () => {
    const c = controller({
      createInvitation: jest
        .fn<SharingController["createInvitation"]>()
        .mockRejectedValue(new Error("offline")),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    await fireEvent.press(screen.getByText("Weiter"));
    await screen.rerender(<CalendarSharingScreen controller={{ ...c, calendars: [own] }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(c.createCalendar).toHaveBeenCalledTimes(1);
    expect(c.createInvitation).toHaveBeenCalledTimes(2);
    expect(c.createInvitation).toHaveBeenLastCalledWith("own");
  });

  it("keeps login optional and only starts a provider after pressing its action", async () => {
    const c = controller({ status: "signedOut", account: null });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Dein eigener Kalender bleibt ohne Konto nutzbar.")).toBeTruthy();
    expect(c.signIn).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Schichten teilen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Weiter" }));
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(c.createInvitation).toHaveBeenCalledWith("own");
    expect(screen.getByTestId("sharing-qr")).toBeTruthy();
    expect(screen.getByText("QR")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sonstige" })).toBeTruthy();
    for (const name of [
      "Mit Nachrichten einladen",
      "Mit WhatsApp einladen",
      "Mit Telegram einladen",
      "Mit E-Mail einladen",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText("Oder per QR-Code teilen")).toBeNull();
    expect(c.shareInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Sonstige" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Sams Plan ansehen" }));
    expect(screen.queryByText("Neue Einladung")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Kalender verlassen" }));
    expect(c.leaveCalendar).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(c.leaveCalendar).toHaveBeenCalledWith("foreign");
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
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByText("Freigabe prüfen"));
    expect(c.publishCalendar).not.toHaveBeenCalled();
    expect(c.preparePublicationPreview).toHaveBeenCalledWith("own");
    expect(screen.getByRole("button", { name: "Freigabe fortsetzen" })).toBeTruthy();
    expect(screen.getByText("24.10. · 21:00–07:30 · Folgetag")).toBeTruthy();
    expect(screen.getByText("Termin")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    expect(c.invite).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Neue Einladung" }));
    expect(c.createInvitation).not.toHaveBeenCalled();
    expect(c.shareInvitation).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Weiter"));
    await fireEvent.press(screen.getByText("Sonstige"));
    expect(c.shareInvitation).toHaveBeenCalledTimes(1);
  });
  it("distinguishes requesting members and active readers with explicit control", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sam erlauben" }));
    expect(c.setMember).toHaveBeenCalledWith("own", "pending", "APPROVE");
    await fireEvent.press(screen.getByRole("button", { name: "Sam ablehnen" }));
    expect(c.setMember).toHaveBeenCalledWith("own", "pending", "REJECT");
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff für Kim entfernen" }));
    await confirmLastAlert();
    expect(c.setMember).toHaveBeenCalledWith("own", "active", "REVOKE");
  });
  it("revokes invitation and deletes cloud calendar after confirmation while preserving local data", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByRole("button", { name: "Einladung stoppen" }));
    expect(c.revokeInvite).toHaveBeenCalledWith("own", "invite");
    await fireEvent.press(screen.getByText("Freigabe beenden"));
    expect(c.deleteCalendar).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "Deine eigenen Dienste bleiben erhalten.",
    );
    await confirmLastAlert();
    expect(c.deleteCalendar).toHaveBeenCalledWith("own");
  });
  it("never renders a backend error message or private account email", async () => {
    const c = controller({ error: true, busy: true, calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Das hat nicht geklappt. Bitte versuche es erneut.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neue Einladung" })).toBeDisabled();
    expect(screen.queryByText(/SHARE_|token|apikey/)).toBeNull();
  });
  it("confirms account deletion and offers signout with local data retained", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Konto" }));
    await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));
    await confirmLastAlert();
    expect(c.signOut).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Konto löschen" }));
    expect(c.deleteAccount).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "Deine eigenen Dienste bleiben erhalten.",
    );
    await confirmLastAlert();
    expect(c.deleteAccount).toHaveBeenCalledTimes(1);
  });
});

describe("Einladung", () => {
  const token = "a".repeat(64);
  it("does not consume a link by rendering it and requires a named explicit request", async () => {
    const c = controller();
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    expect(c.claimInvite).not.toHaveBeenCalled();
    expect(screen.queryByText(token)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Zugriff anfordern" }));
    expect(c.claimInvite).toHaveBeenCalledWith(token, "Alex");
  });
  it("rejects malformed or duplicate tokens without invoking any backend action", async () => {
    const c = controller();
    const screen = await render(<SharingInviteScreen controller={c} token={[token, token]} />);
    expect(screen.getByText("Dieser Einladungslink ist ungültig.")).toBeTruthy();
    expect(screen.queryByText("Zugriff anfordern")).toBeNull();
    expect(c.claimInvite).not.toHaveBeenCalled();
  });
  it("lets signed-out recipients sign in before explicitly requesting access", async () => {
    const c = controller({ status: "signedOut", account: null });
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    expect(screen.queryByText("Zugriff anfordern")).toBeNull();
    await fireEvent.press(screen.getByText("Mit Google fortfahren"));
    expect(c.signIn).toHaveBeenCalledWith("google");
    expect(c.claimInvite).not.toHaveBeenCalled();
  });
  it("shows pending approval without claiming again on rerender", async () => {
    const c = controller({ claimResult: { calendarName: "Sams Plan", status: "PENDING" } });
    const screen = await render(<SharingInviteScreen controller={c} token={token} />);
    await fireEvent.press(screen.getByText("Zugriff anfordern"));
    expect(screen.getByText("Anfrage gesendet")).toBeTruthy();
    expect(screen.getByText("Sams Plan")).toBeTruthy();
    expect(screen.queryByText("Zugriff anfordern")).toBeNull();
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
