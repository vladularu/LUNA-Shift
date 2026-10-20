import { render } from "@testing-library/react-native";
import { beforeEach, expect, it, jest } from "@jest/globals";
import { WidgetCalendarRedirect } from "./widget-day-screen";
let mockDate: string | string[] | undefined;
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
  mockDate = undefined;
});
it.each(["2027-01-03", "2025-12-31", undefined, "2027-02-31", ["2027-01-01", "2027-02-01"]])(
  "opens the start calendar without a day modal or month change for cached widget date %s",
  async (input) => {
    mockDate = input;
    const screen = await render(<WidgetCalendarRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: "/" });
    expect(mockCoordinator.setMonth).not.toHaveBeenCalled();
    expect(screen.toJSON()).toBeNull();
  },
);
