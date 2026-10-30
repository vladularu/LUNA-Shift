import { beforeEach, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SharingCalendarView, SharingController } from "@/domain/sharing-ui-contract";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { MINIMUM_TOUCH_TARGET } from "@/theme/tokens";
import { SharedCalendarFilters } from "./shared-calendar-filters";

const mockSetVisible = jest.fn<SharingController["setVisible"]>().mockResolvedValue();
let mockController: Pick<
  SharingController,
  "status" | "calendars" | "busy" | "error" | "offline" | "setVisible"
>;
jest.mock("@/features/sharing/sharing-ui-provider", () => ({
  useSharingUiController: () => mockController,
}));
const foreign: SharingCalendarView = {
  id: "foreign",
  name: "Selena Müller",
  color: "#527D92",
  visibility: "DETAILS",
  isOwner: false,
  visible: true,
  publishedAt: "2026-10-13T18:00:00Z",
  syncState: "current",
  members: [],
  invites: [],
};
beforeEach(() => {
  mockSetVisible.mockReset().mockResolvedValue();
  mockController = {
    status: "loading",
    calendars: [],
    busy: false,
    error: false,
    setVisible: mockSetVisible,
  };
});

function AccountFilters({
  accountId = "account-a",
  name = "Vlad Ularu",
  ready = true,
  photoUri = null,
}: {
  readonly accountId?: string | null;
  readonly name?: string;
  readonly ready?: boolean;
  readonly photoUri?: string | null;
}) {
  return (
    <PrivateCloudContext
      value={
        {
          user: accountId ? { id: accountId, displayName: name } : null,
          ready,
          photo: { uri: photoUri },
        } as never
      }
    >
      <SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />
    </PrivateCloudContext>
  );
}

it("replaces names with initials while keeping full names and selection accessible", async () => {
  mockController = {
    ...mockController,
    calendars: [
      foreign,
      { ...foreign, id: "laura", name: "Laura Trost", visible: false },
      { ...foreign, id: "elodie", name: "  élodie   Grün  " },
    ],
  };
  const screen = await render(<AccountFilters />);
  for (const initials of ["VU", "SM", "LT", "ÉG"])
    expect(screen.getByText(initials, { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText("Selena Müller")).toBeNull();
  expect(screen.queryByText("Laura Trost")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Selena Müller anzeigen", selected: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Laura Trost anzeigen", selected: false }),
  ).toBeTruthy();
  for (const button of screen.getAllByRole("button"))
    expect(button).toHaveStyle({
      minWidth: MINIMUM_TOUCH_TARGET,
      minHeight: MINIMUM_TOUCH_TARGET,
    });
});

it("shows only the ready signed-in account photo and clears it during account changes", async () => {
  mockController = { ...mockController, calendars: [foreign] };
  const photoUri = "data:image/jpeg;base64,/9j/AAAA";
  const screen = await render(<AccountFilters photoUri={photoUri} />);
  expect(
    screen.getByTestId("calendar-person-photo", { includeHiddenElements: true }).props.source.uri,
  ).toBe(photoUri);
  expect(screen.queryByText("VU", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("SM", { includeHiddenElements: true })).toBeTruthy();
  await screen.rerender(<AccountFilters photoUri={photoUri} ready={false} />);
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  await screen.rerender(<AccountFilters accountId="account-b" name="Alex Sommer" />);
  expect(screen.getByText("AS", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByText("VU", { includeHiddenElements: true })).toBeNull();
  await screen.rerender(<AccountFilters accountId={null} photoUri={photoUri} />);
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Du anzeigen" })).toBeTruthy();
});

it("falls back to initials after an image error and tries a replacement photo", async () => {
  const screen = await render(<AccountFilters photoUri="file:///old-photo.jpg" />);
  await fireEvent(
    screen.getByTestId("calendar-person-photo", { includeHiddenElements: true }),
    "error",
  );
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("VU", { includeHiddenElements: true })).toBeTruthy();
  await screen.rerender(<AccountFilters photoUri="file:///new-photo.jpg" />);
  expect(
    screen.getByTestId("calendar-person-photo", { includeHiddenElements: true }).props.source.uri,
  ).toBe("file:///new-photo.jpg");
});

it("keeps the first filter viewport and own button while startup hydrates and sharing changes", async () => {
  const onOwnVisible = jest.fn();
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
  const own = screen.getByRole("button", { name: "Du anzeigen" });
  const viewport = screen.getByTestId("calendar-person-filter-viewport");
  for (const next of [
    { status: "signedIn" as const, calendars: [] },
    { status: "signedIn" as const, calendars: [foreign] },
    { status: "signedIn" as const, calendars: [{ ...foreign, visible: false }] },
    { status: "signedIn" as const, calendars: [] },
    { status: "signedOut" as const, calendars: [] },
    { status: "unavailable" as const, calendars: [] },
  ]) {
    mockController = { ...mockController, ...next };
    await screen.rerender(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
    expect(screen.getByRole("button", { name: "Du anzeigen" })).toBe(own);
    expect(screen.getByTestId("calendar-person-filter-viewport")).toBe(viewport);
    expect(viewport).toHaveStyle({ height: MINIMUM_TOUCH_TARGET });
    expect(Boolean(screen.queryByRole("button", { name: "Selena Müller anzeigen" }))).toBe(
      next.calendars.length > 0,
    );
  }
});
it.each(["loading", "signedOut", "unavailable"] as const)(
  "keeps own visibility local while sharing is %s",
  async (status) => {
    mockController = { ...mockController, status };
    const onOwnVisible = jest.fn();
    const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
    await fireEvent.press(screen.getByRole("button", { name: "Du anzeigen" }));
    expect(onOwnVisible).toHaveBeenLastCalledWith(false);
    await screen.rerender(<SharedCalendarFilters ownVisible={false} onOwnVisible={onOwnVisible} />);
    expect(screen.getByRole("button", { name: "Du anzeigen", selected: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Du anzeigen" }));
    expect(onOwnVisible).toHaveBeenLastCalledWith(true);
    expect(mockSetVisible).not.toHaveBeenCalled();
  },
);
it("adds shared visibility controls inside the same horizontal row", async () => {
  mockController = { ...mockController, status: "signedIn", calendars: [foreign] };
  const onOwnVisible = jest.fn();
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
  const viewport = screen.getByTestId("calendar-person-filter-viewport");
  expect(viewport.props.horizontal).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Selena Müller anzeigen" }));
  await waitFor(() => expect(mockSetVisible).toHaveBeenCalledWith("foreign", false));
  expect(onOwnVisible).not.toHaveBeenCalled();
  expect(viewport).toHaveStyle({ height: MINIMUM_TOUCH_TARGET });
});

it("keeps person controls responsive during cloud work and pending local saves", async () => {
  let finish!: () => void;
  mockSetVisible.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  mockController = { ...mockController, status: "signedIn", calendars: [foreign], busy: true };
  const onOwnVisible = jest.fn();
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
  await fireEvent.press(screen.getByRole("button", { name: "Selena Müller anzeigen" }));
  expect(mockSetVisible).toHaveBeenLastCalledWith("foreign", false);
  mockController = { ...mockController, calendars: [{ ...foreign, visible: false }] };
  await screen.rerender(<SharedCalendarFilters ownVisible onOwnVisible={onOwnVisible} />);
  expect(
    screen.getByRole("button", { name: "Selena Müller anzeigen", selected: false }),
  ).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Selena Müller anzeigen" }));
  expect(mockSetVisible).toHaveBeenLastCalledWith("foreign", true);
  await fireEvent.press(screen.getByRole("button", { name: "Du anzeigen" }));
  expect(onOwnVisible).toHaveBeenCalledWith(false);
  await act(async () => {
    finish();
  });
});

it("shows a persistence error without locking the person controls", async () => {
  mockController = { ...mockController, status: "signedIn", offline: true, calendars: [foreign] };
  mockSetVisible.mockRejectedValueOnce(new Error("disk full"));
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Selena Müller anzeigen" }));
  await waitFor(() =>
    expect(
      screen.getByText("Freigaben konnten nicht aktualisiert werden. Versuche es erneut."),
    ).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Selena Müller anzeigen" })).toBeEnabled();
});

it("shows a quiet cached offline state and clears it after reconnection", async () => {
  mockController = {
    ...mockController,
    offline: true,
    calendars: [{ ...foreign, syncState: "offline" }],
  };
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  expect(screen.getByText("Offline · Gespeicherter Stand")).toBeTruthy();
  expect(
    screen.queryByText("Freigaben konnten nicht aktualisiert werden. Versuche es erneut."),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Selena Müller anzeigen" })).toBeEnabled();
  mockController = { ...mockController, offline: false, calendars: [foreign] };
  await screen.rerender(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  expect(screen.queryByText("Offline · Gespeicherter Stand")).toBeNull();
});

it("does not claim an expired or absent cache is displayed and keeps real errors visible", async () => {
  mockController = {
    ...mockController,
    offline: true,
    calendars: [{ ...foreign, syncState: "expired" }],
  };
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  expect(screen.getByText("Offline · Freigaben werden später aktualisiert")).toBeTruthy();
  mockController = { ...mockController, error: true };
  await screen.rerender(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  expect(
    screen.getByText("Freigaben konnten nicht aktualisiert werden. Versuche es erneut."),
  ).toBeTruthy();
  expect(screen.queryByText("Offline · Freigaben werden später aktualisiert")).toBeNull();
});

it("reports a failed person save even when another person was toggled afterwards", async () => {
  let fail!: (error: Error) => void;
  mockSetVisible.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      fail = reject;
    }),
  );
  mockController = {
    ...mockController,
    status: "signedIn",
    calendars: [foreign, { ...foreign, id: "other", name: "Sam" }],
  };
  const screen = await render(<SharedCalendarFilters ownVisible onOwnVisible={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Selena Müller anzeigen" }));
  await fireEvent.press(screen.getByRole("button", { name: "Sam anzeigen" }));
  await act(async () => {
    fail(new Error("disk full"));
  });
  expect(
    screen.getByText("Freigaben konnten nicht aktualisiert werden. Versuche es erneut."),
  ).toBeTruthy();
});
