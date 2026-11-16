import { act, fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert, Platform } from "react-native";
import { RustPilotControls } from "./rust-pilot-controls";

let mockAvailable = true;
let mockNative: object | null = {};
const mockRun = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockShare = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("../../../modules/luna-rest-pilot", () => ({
  getNativeRestPilot: () => mockNative,
  loadRestPilotComparison: () => ({ runRestPilot: (...args: unknown[]) => mockRun(...args) }),
}));
jest.mock("../../../modules/luna-rest-pilot/benchmark", () => ({
  runRestPilot: (...args: unknown[]) => mockRun(...args),
}));
jest.mock("./share-calendar-performance", () => ({
  shareCalendarPerformanceFile: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: { cache: {} } }));
jest.mock("expo-updates", () => ({ updateId: "test", runtimeVersion: "test" }));
jest.mock("@/infrastructure/dev-tools-policy", () => ({
  get DEV_TOOLS_AVAILABLE() {
    return mockAvailable;
  },
}));

describe("manual native comparison", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockAvailable = true;
    mockNative = {};
    mockRun.mockReset();
    mockShare.mockReset();
  });
  it("is absent in production and never runs from rendering", async () => {
    mockAvailable = false;
    const screen = await render(<RustPilotControls />);
    expect(screen.queryByText("Rust-Vergleich starten")).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });
  it("explains the missing module on an old Preview without starting a run", async () => {
    mockNative = null;
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const screen = await render(<RustPilotControls />);
    await fireEvent.press(screen.getByText("Rust-Vergleich starten"));
    expect(alert).toHaveBeenCalledWith("Neuer Preview-Build erforderlich", expect.any(String));
    expect(mockRun).not.toHaveBeenCalled();
    alert.mockRestore();
  });
  it("exports only a completed explicitly requested comparison", async () => {
    mockRun.mockResolvedValue({ allResultsEqual: true, samples: [] });
    mockShare.mockResolvedValue(undefined);
    const screen = await render(<RustPilotControls />);
    expect(screen.queryByText("Rust-Bericht teilen")).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByText("Rust-Vergleich starten"));
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText("Rust-Bericht teilen"));
    expect(mockShare).toHaveBeenCalledWith(
      expect.stringContaining('"allResultsEqual": true'),
      expect.anything(),
    );
  });
  it("rejects double taps and cancels result delivery on unmount", async () => {
    let finish!: (value: unknown) => void;
    mockRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const screen = await render(<RustPilotControls />);
    await act(async () => {
      await fireEvent.press(screen.getByText("Rust-Vergleich starten"));
    });
    await fireEvent.press(screen.getByText("Rust-Vergleich starten"));
    expect(mockRun).toHaveBeenCalledTimes(1);
    const options = mockRun.mock.calls[0][1] as { signal: AbortSignal };
    await screen.unmount();
    expect(options.signal.aborted).toBe(true);
    await act(async () => {
      finish({ allResultsEqual: true });
    });
    expect(mockShare).not.toHaveBeenCalled();
  });
});
