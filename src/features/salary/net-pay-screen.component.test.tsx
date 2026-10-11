import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { NetPayScreen } from "./net-pay-screen";

let mockParams: Record<string, string | string[] | undefined>;
const mockAutomatic = jest.fn<(props: { month: string }) => null>(() => null);
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("./net-pay-automatic-screen", () => ({
  NetPayAutomaticScreen: (props: { month: string }) => mockAutomatic(props),
}));

describe("automatic net-pay route", () => {
  beforeEach(() => {
    mockParams = { month: "2026-07" };
    mockAutomatic.mockClear();
    jest.mocked(router.back).mockClear();
  });
  it.each(["2026-07", "2027-01"])("opens the automatic forecast for %s", async (month) => {
    mockParams = { month };
    await render(<NetPayScreen />);
    expect(mockAutomatic).toHaveBeenCalledWith({ month });
  });
  it("keeps legacy manual URLs on the automatic workflow", async () => {
    mockParams = { month: "2026-07", mode: "manual", gross: "999999" };
    const screen = await render(<NetPayScreen />);
    expect(mockAutomatic).toHaveBeenCalledWith({ month: "2026-07" });
    expect(screen.queryByLabelText("Gesamtbrutto (€)")).toBeNull();
  });
  it.each([undefined, "bad", "2026-13", ["2026-07", "2026-08"]])(
    "rejects an invalid or missing month (%s)",
    async (month) => {
      mockParams = { month };
      const screen = await render(<NetPayScreen />);
      expect(mockAutomatic).not.toHaveBeenCalled();
      expect(screen.getByText("Ungültiger Abrechnungsmonat")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
      expect(router.back).toHaveBeenCalledTimes(1);
    },
  );
});
