import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
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
    createCalendar: action(),
    preparePublicationPreview: jest
      .fn<SharingController["preparePublicationPreview"]>()
      .mockResolvedValue({
        confirmationId: "confirmation",
        entryCount: 1,
        entries: [{ title: "Spät", when: "12.10. · 13:00–21:00" }],
      }),
    publishCalendar: action(),
    setVisible: action(),
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
  invites: [{ id: "invite", expiresAt: "2026-10-19T12:30:00Z", consumedAt: null, revokedAt: null }],
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
  it("keeps login optional and only starts a provider after pressing its action", async () => {
    const c = controller({ status: "signedOut", account: null });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Dein Kalender bleibt ohne Konto nutzbar.")).toBeTruthy();
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
  it("requires a privacy preview and confirmation before connecting the local plan", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Eigenen Kalender teilen" }));
    expect(screen.getByText("Termine bleiben privat.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Nur Verfügbarkeit" }));
    await fireEvent.press(screen.getByRole("button", { name: "Vorschau ansehen" }));
    expect(c.preview).toHaveBeenCalledWith("AVAILABILITY", []);
    expect(c.createCalendar).not.toHaveBeenCalled();
    expect(screen.getByText("Notizen, Orte und Gehalt bleiben privat.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Diesen Dienstplan freigeben" }));
    expect(c.createCalendar).toHaveBeenCalledWith({
      name: "Mein Dienstplan",
      color: "#527D92",
      visibility: "AVAILABILITY",
      confirmed: true,
    });
  });
  it("blocks a blank calendar name and resets preview after changing the privacy mode", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Eigenen Kalender teilen"));
    await fireEvent.changeText(screen.getByLabelText("Kalendername"), "   ");
    expect(screen.getByRole("button", { name: "Vorschau ansehen" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Kalendername"), "Mein Plan");
    await fireEvent.press(screen.getByText("Vorschau ansehen"));
    await fireEvent.press(screen.getByText("Nur Verfügbarkeit"));
    expect(screen.queryByRole("button", { name: "Diesen Dienstplan freigeben" })).toBeNull();
  });
  it("lets readers hide a calendar without exposing owner actions", async () => {
    const c = controller({ calendars: [foreign] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent(screen.getByLabelText("Sams Plan im Kalender anzeigen"), "valueChange", false);
    expect(c.setVisible).toHaveBeenCalledWith("foreign", false);
    await fireEvent.press(screen.getByRole("button", { name: "Sams Plan verwalten" }));
    expect(screen.queryByText("Person einladen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Kalender verlassen" }));
    expect(c.leaveCalendar).not.toHaveBeenCalled();
    await confirmLastAlert();
    expect(c.leaveCalendar).toHaveBeenCalledWith("foreign");
  });
  it("requires a fresh safe preview before any manual update and cancellation publishes nothing", async () => {
    const c = controller({
      calendars: [{ ...own, selectedAppointmentIds: ["consented-appointment"] }],
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
    await fireEvent.press(screen.getByText("Dienstplan aktualisieren"));
    expect(c.publishCalendar).not.toHaveBeenCalled();
    expect(c.preparePublicationPreview).toHaveBeenCalledWith("own");
    expect(screen.getByText("2 Einträge")).toBeTruthy();
    expect(screen.getByText("24.10. · 21:00–07:30 · Folgetag")).toBeTruthy();
    expect(screen.getByText("Termin")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Abbrechen" }));
    expect(c.publishCalendar).not.toHaveBeenCalled();
    expect(screen.getByText("Dienstplan aktualisieren")).toBeTruthy();
  });
  it("previews a restore-cleared appointment selection and only publishes the selected calendar on confirmation", async () => {
    const c = controller({
      calendars: [{ ...own, syncState: "pending", selectedAppointmentIds: [] }],
      availableAppointments: [
        { id: "restored", title: "Private restored appointment", date: "25.10." },
      ],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByText("Dienstplan aktualisieren"));
    expect(c.preparePublicationPreview).toHaveBeenCalledWith("own");
    expect(screen.queryByText("Private restored appointment")).toBeNull();
    expect(c.publishCalendar).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Aktualisierung freigeben" }));
    expect(c.publishCalendar).toHaveBeenCalledTimes(1);
    expect(c.publishCalendar).toHaveBeenCalledWith("own", "confirmation");
    expect(screen.getByText("Dienstplan aktualisieren")).toBeTruthy();
  });
  it("requires a new local preparation after a confirmed preview becomes stale", async () => {
    const c = controller({
      calendars: [own],
      publishCalendar: jest
        .fn<SharingController["publishCalendar"]>()
        .mockRejectedValue(new Error("SHARE_PREVIEW_STALE")),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByText("Dienstplan aktualisieren"));
    await fireEvent.press(screen.getByRole("button", { name: "Aktualisierung freigeben" }));
    expect(screen.queryByText("Aktualisierung freigeben")).toBeNull();
    expect(screen.getByText("Dienstplan aktualisieren")).toBeTruthy();
    expect(screen.queryByText("SHARE_PREVIEW_STALE")).toBeNull();
    await fireEvent.press(screen.getByText("Dienstplan aktualisieren"));
    expect(c.preparePublicationPreview).toHaveBeenCalledTimes(2);
    expect(c.publishCalendar).toHaveBeenCalledTimes(1);
  });
  it("opens OS sharing only through the explicit invitation action", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    expect(c.invite).not.toHaveBeenCalled();
    expect(screen.getByText("Einmal verwendbar · 7 Tage gültig")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Person einladen" }));
    expect(c.invite).toHaveBeenCalledWith("own");
  });
  it("distinguishes requesting members and active readers with explicit control", async () => {
    const c = controller({ calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Mein Dienstplan verwalten" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sam bestätigen" }));
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
    await fireEvent.press(screen.getByRole("button", { name: "Einladung widerrufen" }));
    expect(c.revokeInvite).toHaveBeenCalledWith("own", "invite");
    await fireEvent.press(screen.getByText("Freigabe löschen"));
    expect(c.deleteCalendar).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "Deine lokalen Dienste bleiben erhalten.",
    );
    await confirmLastAlert();
    expect(c.deleteCalendar).toHaveBeenCalledWith("own");
  });
  it("never renders a backend error message or private account email", async () => {
    const c = controller({ error: true, busy: true, calendars: [own] });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.getByText("Das hat nicht geklappt. Bitte versuche es erneut.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeDisabled();
    expect(screen.queryByText(/SHARE_|token|apikey/)).toBeNull();
  });
  it("confirms account deletion and offers signout with local data retained", async () => {
    const c = controller();
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByRole("button", { name: "Abmelden" }));
    await confirmLastAlert();
    expect(c.signOut).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Konto löschen" }));
    expect(c.deleteAccount).not.toHaveBeenCalled();
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toContain(
      "Deine lokalen Dienste und Einstellungen bleiben erhalten.",
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
