import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { SharingInviteScreen, parseSharingInviteToken } from "./sharing-invite-screen";
import { SharingUiProvider } from "./sharing-ui-provider";
import { updateLabel } from "./sharing-ui-elements";
import type { SharingController } from "./sharing-ui-contract";
import CalendarSharingRoute from "../../../app/calendar-sharing";
import SharingInviteRoute from "../../../app/sharing-invite";

let mockParams: { token?: string | string[] } = {};
const mockHeader = jest.fn();
jest.mock("expo-router", () => ({
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
    createCalendar: action(),
    preparePublicationPreview: jest
      .fn<SharingController["preparePublicationPreview"]>()
      .mockResolvedValue({ confirmationId: "confirmation", entryCount: 0, entries: [] }),
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

describe("Freigabe UI Grenzen", () => {
  it("shares no appointment unless specifically selected and previews that selection", async () => {
    const c = controller({
      availableAppointments: [{ id: "appointment", title: "Privater Titel", date: "15.10." }],
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Eigenen Kalender teilen"));
    const toggle = screen.getByLabelText("Privater Titel am 15.10. freigeben");
    expect(toggle.props.accessibilityState.checked).toBe(false);
    await fireEvent(toggle, "valueChange", true);
    await fireEvent.press(screen.getByText("Vorschau ansehen"));
    expect(c.preview).toHaveBeenCalledWith("DETAILS", ["appointment"]);
    await fireEvent.press(screen.getByText("Diesen Dienstplan freigeben"));
    expect(c.createCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ selectedAppointmentIds: ["appointment"], confirmed: true }),
    );
  });
  it("keeps creation open with a concise failure and allows an intentional retry", async () => {
    const c = controller({
      createCalendar: jest
        .fn<SharingController["createCalendar"]>()
        .mockRejectedValueOnce(new Error("raw secret token must not appear"))
        .mockResolvedValue(),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Eigenen Kalender teilen"));
    await fireEvent.press(screen.getByText("Vorschau ansehen"));
    await fireEvent.press(screen.getByText("Diesen Dienstplan freigeben"));
    expect(screen.getByText("Das hat nicht geklappt. Bitte versuche es erneut.")).toBeTruthy();
    expect(screen.queryByText(/raw secret/)).toBeNull();
    await fireEvent.press(screen.getByText("Diesen Dienstplan freigeben"));
    expect(c.createCalendar).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Eigenen Kalender teilen")).toBeTruthy();
  });
  it("blocks overlapping provider requests while an authentication request is running", async () => {
    let done!: () => void;
    const c = controller({
      status: "signedOut",
      signIn: jest.fn<SharingController["signIn"]>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
      ),
    });
    const screen = await render(<CalendarSharingScreen controller={c} />);
    await fireEvent.press(screen.getByText("Mit Google fortfahren"));
    expect(screen.getByRole("button", { name: "Mit Apple fortfahren" })).toBeDisabled();
    await fireEvent.press(screen.getByText("Mit Apple fortfahren"));
    expect(c.signIn).toHaveBeenCalledTimes(1);
    await act(async () => done());
  });
  it("shows a loading state and keeps cloud account deletion unavailable when not configured", async () => {
    const screen = await render(
      <CalendarSharingScreen controller={controller({ status: "loading" })} />,
    );
    expect(screen.getByText("Kalenderfreigaben werden geladen …")).toBeTruthy();
    await screen.rerender(
      <CalendarSharingScreen controller={controller({ accountDeletionAvailable: false })} />,
    );
    expect(screen.getByRole("button", { name: /Konto löschen/ })).toBeDisabled();
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
        options: expect.objectContaining({ title: "Kalender teilen", headerShown: true }),
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
    await fireEvent.press(screen.getByText("Zugriff anfordern"));
    expect(c.claimInvite).toHaveBeenCalledTimes(1);
  });
  it("keeps the invite request disabled until a display name exists", async () => {
    const screen = await render(
      <SharingInviteScreen controller={controller({ account: null })} token={"a".repeat(64)} />,
    );
    expect(screen.getByText("Zugriff anfordern")).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Dein Anzeigename"), "Alex");
    expect(screen.getByRole("button", { name: "Zugriff anfordern" })).not.toBeDisabled();
  });
  it("does not show a result from a different invitation before an explicit claim", async () => {
    const c = controller({
      claimResult: { calendarName: "Vorheriger Kalender", status: "PENDING" },
    });
    const screen = await render(<SharingInviteScreen controller={c} token={"b".repeat(64)} />);
    expect(screen.queryByText("Vorheriger Kalender")).toBeNull();
    expect(screen.getByText("Zugriff anfordern")).toBeTruthy();
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
