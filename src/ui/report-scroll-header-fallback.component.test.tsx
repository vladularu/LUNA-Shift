import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import { ReportScrollHeader, ReportScrollHeaderProvider } from "./report-scroll-header";
import { ReportScrollView } from "./report-layout";

jest.mock("expo", () => {
  process.env.EXPO_OS = "ios";
  const { Platform } = jest.requireActual<typeof import("react-native")>("react-native");
  Object.defineProperty(Platform, "Version", { configurable: true, get: () => 26 });
  return { requireOptionalNativeModule: () => null };
});
jest.mock("@bsky.app/expo-scroll-edge-effect", () => {
  throw new Error("A binary without ExpoScrollEdgeEffect must not load its native view");
});

describe("system scroll edge binary guard", () => {
  it("keeps the ordinary fixed header on a binary without the native scroll-edge module", async () => {
    const screen = await render(
      <ReportScrollHeaderProvider>
        <ReportScrollHeader>
          <Text>Auswertung</Text>
        </ReportScrollHeader>
        <ReportScrollView>
          <Text>Bericht</Text>
        </ReportScrollView>
      </ReportScrollHeaderProvider>,
    );
    expect(screen.getByText("Auswertung")).toBeVisible();
    expect(screen.getByText("Bericht")).toBeVisible();
    expect(screen.queryByTestId("report-scroll-header")).toBeNull();
    expect(screen.queryByTestId("report-scroll-edge")).toBeNull();
  });
});
