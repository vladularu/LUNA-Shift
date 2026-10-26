import { render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { CheckProfileScreen } from "./check-profile-screen";
let mockParams: Record<string, unknown> = {};
const mockEditor = jest.fn();
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("./settings-editor-screen", () => ({
  SettingsEditorScreen: (props: unknown) => {
    mockEditor(props);
    return null;
  },
}));
beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
});
describe("legacy model recovery routes", () => {
  it("opens the shared model editor instead of a separate question wizard", async () => {
    await render(<CheckProfileScreen />);
    expect(mockEditor).toHaveBeenCalledWith({ sectionOverride: "EMPLOYMENT" });
  });
  it.each(["all", "2026-10-26"])(
    "does not impose a hidden inherited scope from %s",
    async (effectiveFrom) => {
      mockParams = { questions: "sunday", effectiveFrom };
      await render(<CheckProfileScreen />);
      expect(mockEditor).toHaveBeenCalledWith({ sectionOverride: "MODEL" });
    },
  );
  it.each([
    { questions: "unknown" },
    { questions: ["sunday"] },
    { effectiveFrom: "2026-02-30" },
    { effectiveFrom: ["all"] },
  ])("rejects malformed legacy links %p", async (params) => {
    mockParams = params;
    const screen = await render(<CheckProfileScreen />);
    expect(screen.getByText("Angaben können nicht geöffnet werden")).toBeTruthy();
    expect(mockEditor).not.toHaveBeenCalled();
  });
});

it("keeps regional holiday recovery reachable in the work fields", async () => {
  mockParams = { questions: "region" };
  await render(<CheckProfileScreen />);
  expect(mockEditor).toHaveBeenCalledWith({ sectionOverride: "WORK" });
});
