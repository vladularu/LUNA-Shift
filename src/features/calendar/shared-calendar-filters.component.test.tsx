import { beforeEach, expect, it, jest } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SharingCalendarView, SharingController } from "@/domain/sharing-ui-contract";
import { MINIMUM_TOUCH_TARGET } from "@/theme/tokens";
import { SharedCalendarFilters } from "./shared-calendar-filters";

const mockSetVisible = jest.fn<SharingController["setVisible"]>().mockResolvedValue();
let mockController: Pick<
  SharingController,
  "status" | "calendars" | "busy" | "error" | "setVisible"
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
  mockSetVisible.mockClear();
  mockController = {
    status: "loading",
    calendars: [],
    busy: false,
    error: false,
    setVisible: mockSetVisible,
  };
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
