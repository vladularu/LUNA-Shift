import { render } from "@testing-library/react-native";
import { beforeEach, expect, it, jest } from "@jest/globals";
import { WidgetCalendarRedirect } from "./widget-day-screen";
let mockDate: string | string[] | undefined = "2027-01-03";
const mockRedirect = jest.fn();
const mockCoordinator = { setMonth: jest.fn() };
jest.mock("@/navigation/active-month", () => ({
  useActiveMonthCoordinator: () => mockCoordinator,
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ date: mockDate }),
  Redirect: (props: object) => {
    mockRedirect(props);
    return null;
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockDate = "2027-01-03";
});
it("redirects previously installed widget links to the matching day", async () => {
  const screen = await render(<WidgetCalendarRedirect />);
  expect(mockRedirect).toHaveBeenCalledWith({
    href: { pathname: "/day-details", params: { date: "2027-01-03" } },
  });
  expect(mockCoordinator.setMonth).toHaveBeenCalledWith("2027-01");
  expect(screen.toJSON()).toBeNull();
});
it.each([undefined, "2027-02-31", ["2027-01-01", "2027-02-01"]])(
  "opens the calendar safely for invalid or missing dates %s",
  async (input) => {
    mockDate = input;
    const screen = await render(<WidgetCalendarRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: "/" });
    expect(screen.toJSON()).toBeNull();
  },
);
