import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { AppState, type AppStateStatus } from "react-native";
import { CheckRunnerEgg } from "./check-runner-egg";
import { createRunnerRun, emptyRunnerProgress } from "./dino-runner-engine";
import { loadRunnerProgress, saveRunnerProgress } from "./dino-runner-storage";

const mockDb = {};
let mockBlur: (() => void) | undefined;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(() => {
      const cleanup = effect();
      mockBlur = cleanup || undefined;
      return cleanup;
    }, [effect]);
  },
}));
jest.mock("./dino-runner-storage", () => ({
  loadRunnerProgress: jest.fn(),
  saveRunnerProgress: jest.fn(),
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  jest.mocked(loadRunnerProgress).mockResolvedValue(emptyRunnerProgress());
  jest.mocked(saveRunnerProgress).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

async function unlock(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(screen.getByRole("button", { name: "Prüfungs-Dino" }));
  await fireEvent.press(screen.getByRole("button", { name: "Prüfungs-Dino" }));
}

it("only opens on a fast double tap and runs without visible controls", async () => {
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  expect(screen.getByTestId("dino-runner-idle", { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Prüfungs-Dino" }));
  expect(screen.queryByTestId("dino-runner")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  await fireEvent.press(screen.getByRole("button", { name: "Prüfungs-Dino" }));
  expect(screen.queryByTestId("dino-runner")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Prüfungs-Dino" }));
  expect(screen.getByTestId("dino-runner")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Springen" })).toBeTruthy();
  expect(screen.queryByText("LUNA Run")).toBeNull();
  expect(screen.queryByText("Deine Top 10")).toBeNull();
  expect(screen.queryByText("Tippen zum Springen.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Loslaufen" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spiel schließen" })).toBeNull();
  expect(screen.getByTestId("dino-runner").props.style).not.toEqual(
    expect.objectContaining({ backgroundColor: expect.anything() }),
  );
  await screen.rerender(<CheckRunnerEgg title="Prüfung abgeschlossen" active={false} />);
  expect(screen.getByRole("header", { name: "Prüfung abgeschlossen" })).toBeTruthy();
  await screen.rerender(<CheckRunnerEgg title="Prüfung abgeschlossen" active />);
  await unlock(screen);
  expect(loadRunnerProgress).toHaveBeenCalledTimes(2);
});

it("automatically resumes the saved run, shows one record, and jumps on touch", async () => {
  jest.mocked(loadRunnerProgress).mockResolvedValue({
    version: 1,
    run: { ...createRunnerRun(9), distance: 1250, y: 35, velocity: 80 },
    scores: [{ points: 432, at: "2026-10-14T12:00:00Z" }],
  });
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  expect(screen.getByLabelText("Punkte 125")).toBeTruthy();
  expect(screen.getByText("HI 00432")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Fortsetzen" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  await fireEvent.press(screen.getByTestId("runner-field"));
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  await act(async () => mockBlur?.());
  expect(jest.mocked(saveRunnerProgress).mock.calls.at(-1)?.[1].run?.distance).toBeGreaterThan(
    1250,
  );
});

it("restarts by tapping the background after a collision", async () => {
  jest.mocked(loadRunnerProgress).mockResolvedValue({
    version: 1,
    run: { ...createRunnerRun(9), obstacles: [{ x: 86, width: 20, height: 40 }] },
    scores: [{ points: 432, at: "2026-10-14T12:00:00Z" }],
  });
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await act(async () => jest.advanceTimersByTime(300));
  expect(screen.getByRole("button", { name: "Nochmal spielen" })).toBeTruthy();
  expect(screen.queryByText("Nochmal spielen")).toBeNull();
  await fireEvent.press(screen.getByTestId("runner-field"));
  expect(screen.getByRole("button", { name: "Springen" })).toBeTruthy();
  expect(screen.getByLabelText("Punkte 0")).toBeTruthy();
  expect(screen.getByText("HI 00432")).toBeTruthy();
});

it("jumps when the running background is tapped", async () => {
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await fireEvent.press(screen.getByTestId("runner-field"));
  await act(async () => jest.advanceTimersByTime(120));
  await act(async () => mockBlur?.());
  expect(jest.mocked(saveRunnerProgress).mock.calls.at(-1)?.[1].run?.y).toBeGreaterThan(0);
});

it("ends a naturally spawned unattended run and stops awarding points", async () => {
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await act(async () => jest.advanceTimersByTime(10000));
  expect(screen.getByRole("button", { name: "Nochmal spielen" })).toBeTruthy();
  const saved = jest.mocked(saveRunnerProgress).mock.calls.at(-1)?.[1];
  expect(saved?.run).toBeNull();
  expect(saved?.scores[0]?.points).toBeGreaterThan(0);
  const finalScore = screen.getByTestId("runner-score").props.accessibilityLabel;
  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.getByTestId("runner-score").props.accessibilityLabel).toBe(finalScore);
});

it("renders saved bird and cactus group patterns on the transparent background", async () => {
  jest.mocked(loadRunnerProgress).mockResolvedValue({
    version: 1,
    run: {
      ...createRunnerRun(9),
      elapsed: 35,
      obstacles: [
        { kind: "bird", bottom: 60, x: 250, width: 36, height: 24 },
        { kind: "cactus", count: 3, bottom: 0, x: 450, width: 84, height: 46 },
      ],
    },
    scores: [{ points: 432, at: "2026-10-14T12:00:00Z" }],
  });
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  expect(screen.getByTestId("runner-obstacle-bird", { includeHiddenElements: true })).toBeTruthy();
  expect(
    screen.getByTestId("runner-obstacle-cactus", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.getByText("HI 00432")).toBeTruthy();
  expect(screen.queryByText("LUNA Run")).toBeNull();
});

it("returns to the check on navigation and requires another double tap", async () => {
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await screen.rerender(<CheckRunnerEgg title="Prüfung abgeschlossen" active={false} />);
  expect(screen.queryByTestId("dino-runner")).toBeNull();
  await screen.rerender(<CheckRunnerEgg title="Prüfung abgeschlossen" active />);
  expect(screen.getByRole("button", { name: "Prüfungs-Dino" })).toBeTruthy();
  expect(screen.queryByTestId("dino-runner")).toBeNull();
});

it("immediately pauses and hides on navigation blur, even before another render", async () => {
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await act(async () => {
    jest.advanceTimersByTime(100);
    mockBlur?.();
  });
  expect(screen.queryByTestId("dino-runner")).toBeNull();
  const savesAfterBlur = jest.mocked(saveRunnerProgress).mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(saveRunnerProgress).toHaveBeenCalledTimes(savesAfterBlur);
  await unlock(screen);
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
});

it("closes and saves when the app goes to the background", async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await act(async () => {
    jest.advanceTimersByTime(100);
    listeners.forEach((listener) => listener("background"));
  });
  expect(screen.queryByTestId("dino-runner")).toBeNull();
  expect(saveRunnerProgress).toHaveBeenCalled();
});

it("does not overwrite a stored run when loading fails, and offers retry", async () => {
  jest.mocked(loadRunnerProgress).mockRejectedValueOnce(new Error("locked"));
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  expect(screen.getByText("Spielstand konnte nicht geladen werden.")).toBeTruthy();
  expect(saveRunnerProgress).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Erneut laden" }));
  expect(screen.getByRole("button", { name: "Springen" })).toBeTruthy();
});

it("shows a save failure and retries without losing the in-memory run", async () => {
  jest.mocked(saveRunnerProgress).mockRejectedValue(new Error("full"));
  const screen = await render(<CheckRunnerEgg title="Prüfung abgeschlossen" />);
  await unlock(screen);
  await act(async () => {
    jest.advanceTimersByTime(1200);
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  jest.mocked(saveRunnerProgress).mockResolvedValue(undefined);
  await fireEvent.press(screen.getByRole("button", { name: "Erneut speichern" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Springen" })).toBeTruthy();
});
