import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { SharingInviteScreen, parseSharingInviteToken } from "./sharing-invite-screen";
import { SharingUiProvider } from "./sharing-ui-provider";
import { updateLabel } from "./sharing-ui-elements";
import type { SharingController } from "./sharing-ui-contract";
import CalendarSharingRoute from "../../../app/calendar-sharing";
import SharingInviteRoute from "../../../app/sharing-invite";

let mockParams: { token?: string | string[] } = {};
const mockHeader = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (route: string) => mockPush(route),
    canGoBack: () => true,
    back: () => mockBack(),
    replace: (route: string) => mockReplace(route),
  },
  Stack: {
    Screen: (props: unknown) => {
      mockHeader(props);
      return null;
    },
  },
  useLocalSearchParams: () => mockParams,
}));
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
    preview: jest.fn(() => ({ entryCount: 0, entries: [] })),
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
      .mockResolvedValue({ confirmationId: "confirmation", entryCount: 0, entries: [] }),
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

describe("Freigabe UI Grenzen", () => {
  it.each([
    {
      status: "ACTIVE" as const,
      title: "Kalender hinzugefügt",
      action: "Zum Kalender",
      route: "/",
    },
    {
      status: "PENDING" as const,
      title: "Anfrage gesendet",
      action: "Zu den Freigaben",
      route: "/calendar-sharing",
    },
  ])(
    "follows the actual $status result after explicit acceptance",
    async ({ status, title, action, route }) => {
      const c = controller({ claimResult: { calendarName: "Sams Plan", status } });
      const screen = await render(<SharingInviteScreen controller={c} token={"a".repeat(64)} />);
      expect(screen.queryByText(/bestätigt dich, bevor Kalenderdaten/)).toBeNull();
      expect(c.claimInvite).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Einladung annehmen" }));
      expect(c.claimInvite).toHaveBeenCalledTimes(1);
      expect(screen.getByText(title)).toBeTruthy();
      if (status === "ACTIVE")
        expect(screen.queryByText(/muss deinen Zugriff noch bestätigen/)).toBeNull();
      else expect(screen.getByText("Die Person muss deinen Zugriff noch bestätigen.")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: action }));
      expect(mockReplace).toHaveBeenCalledWith(route);
    },
  );
  it("keeps a failed acceptance retryable without showing the backend reason", async () => {
    const c = controller({
      claimInvite: jest
        .fn<SharingController["claimInvite"]>()
        .mockRejectedValueOnce(new Error("SHARE_INTERNAL secret"))
        .mockResolvedValue(),
      claimResult: { calendarName: "Sams Plan", status: "ACTIVE" },
    });
    const screen = await render(<SharingInviteScreen controller={c} token={"a".repeat(64)} />);
    await fireEvent.press(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(
      screen.getByText("Einladung konnte nicht angenommen werden. Versuche es erneut."),
    ).toBeTruthy();
    expect(screen.queryByText(/SHARE_INTERNAL secret/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Zum Kalender" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Einladung annehmen" }));
    expect(c.claimInvite).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/konnte nicht angenommen werden/)).toBeNull();
    expect(screen.getByRole("button", { name: "Zum Kalender" })).toBeTruthy();
  });
  it("keeps a visible way back from the calendar header route", async () => {
    const c = controller();
    const screen = await render(
      <SharingUiProvider controller={c}>
        <CalendarSharingRoute />
      </SharingUiProvider>,
    );
    expect(screen.getAllByRole("button", { name: /^Neue Einladung(?: erstellen)?$/ })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: "Neue Einladung" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Kalender" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
  it("shares only explicitly selected appointments after the creation action", async () => {
    const c = controller({
      availableAppointments: [{ id: "appointment", title: "Privater Titel", date: "15.10." }],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Neue Einladung"));
    const toggle = screen.getByRole("button", { name: "Termine teilen" });
    expect(toggle.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(toggle);
    await fireEvent.press(screen.getByText("Einladung erstellen"));
    expect(c.createCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ selectedAppointmentIds: ["appointment"], confirmed: true }),
    );
  });
  it("keeps creation open with a concise failure and allows an intentional retry", async () => {
    const c = controller({
      createCalendar: jest
        .fn<SharingController["createCalendar"]>()
        .mockRejectedValueOnce(new Error("raw secret token must not appear"))
        .mockResolvedValue("own"),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Neue Einladung"));

    await fireEvent.press(screen.getByText("Einladung erstellen"));
    expect(
      screen.getByText("Einladung konnte nicht erstellt werden. Versuche es erneut."),
    ).toBeTruthy();
    expect(screen.queryByText(/raw secret/)).toBeNull();
    await fireEvent.press(screen.getByText("Einladung erstellen"));
    expect(c.createCalendar).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Sende deine Einladung")).toBeTruthy();
  });
  it("shows a loading state and keeps cloud account deletion unavailable when not configured", async () => {
    const screen = await render(
      <CalendarSharingScreen controller={controller({ status: "loading" })} />,
    );
    expect(screen.getByText("Freigaben werden geladen …")).toBeTruthy();
    await screen.rerender(
      <CalendarSharingScreen controller={controller({ accountDeletionAvailable: false })} />,
    );
    expect(screen.queryByRole("button", { name: "Konto" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Konto löschen/ })).toBeNull();
  });
  it("handles missing, overlong, malformed and duplicate invitation tokens safely", () => {
    for (const value of [
      undefined,
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "../",
      ["a".repeat(64)],
    ])
      expect(parseSharingInviteToken(value)).toBeNull();
    expect(parseSharingInviteToken("0a".repeat(32))).toBe("0a".repeat(32));
  });
  it("never throws on a malformed sync timestamp", () => {
    expect(updateLabel(null)).toBe("Noch nicht aktualisiert");
    expect(updateLabel("invalid")).toBe("Letzter Stand unbekannt");
    expect(updateLabel("2026-10-12T12:30:00Z")).toMatch(/12\.10\./);
  });
  it("uses the real injected controller through the calendar sharing route", async () => {
    const c = controller({ status: "signedOut", appleAvailable: false });
    const screen = await render(
      <SharingUiProvider controller={c}>
        <CalendarSharingRoute />
      </SharingUiProvider>,
    );
    expect(screen.queryByText("Mit Apple fortfahren")).toBeNull();
    await fireEvent.press(screen.getByText("Mit Google fortfahren"));
    expect(c.signIn).toHaveBeenCalledWith("google");
    expect(mockHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ title: "Kalender teilen", headerShown: false }),
      }),
    );
  });
  it("keeps both routes fail-closed without their provider", async () => {
    const screen = await render(<CalendarSharingRoute />);
    expect(screen.getByText("Kalenderfreigaben sind noch nicht eingerichtet.")).toBeTruthy();
    await screen.rerender(<SharingInviteRoute />);
    expect(screen.getByText("Kalenderfreigaben sind noch nicht eingerichtet.")).toBeTruthy();
  });
  it("parses route token without requesting access on mount", async () => {
    mockParams = { token: "a".repeat(64) };
    const c = controller();
    const screen = await render(
      <SharingUiProvider controller={c}>
        <SharingInviteRoute />
      </SharingUiProvider>,
    );
    expect(c.claimInvite).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Einladung annehmen"));
    expect(c.claimInvite).toHaveBeenCalledTimes(1);
  });
  it("keeps the invite request disabled until a display name exists", async () => {
    const screen = await render(
      <SharingInviteScreen controller={controller({ account: null })} token={"a".repeat(64)} />,
    );
    expect(screen.getByText("Einladung annehmen")).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Dein Anzeigename"), "Alex");
    expect(screen.getByRole("button", { name: "Einladung annehmen" })).not.toBeDisabled();
  });
  it("does not show a result from a different invitation before an explicit claim", async () => {
    const c = controller({
      claimResult: { calendarName: "Vorheriger Kalender", status: "PENDING" },
    });
    const screen = await render(<SharingInviteScreen controller={c} token={"b".repeat(64)} />);
    expect(screen.queryByText("Vorheriger Kalender")).toBeNull();
    expect(screen.getByText("Einladung annehmen")).toBeTruthy();
    expect(c.claimInvite).not.toHaveBeenCalled();
  });
  it("has no owner visibility switch that would falsely imply hiding local shifts", async () => {
    const c = controller({
      calendars: [
        {
          id: "own",
          name: "Mein Plan",
          color: "#527D92",
          visibility: "DETAILS",
          isOwner: true,
          visible: true,
          publishedAt: null,
          syncState: "current",
          members: [],
          invites: [],
        },
      ],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    expect(screen.queryByLabelText("Mein Plan im Kalender anzeigen")).toBeNull();
  });
});
