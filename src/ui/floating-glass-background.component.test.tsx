import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Platform } from "react-native";

import { FloatingGlassBackground } from "./floating-glass-background";

describe("FloatingGlassBackground", () => {
  it.each([
    { mode: "light", dark: false, version: "26.0", reducedOpacity: false },
    { mode: "light", dark: false, version: "26.1", reducedOpacity: true },
    { mode: "light", dark: false, version: "27.0", reducedOpacity: true },
    { mode: "dark", dark: true, version: "27.0", reducedOpacity: false },
  ])(
    "uses regular glass in $mode mode on iOS $version",
    async ({ mode, dark, version, reducedOpacity }) => {
      const systemVersion = jest.spyOn(Platform, "Version", "get").mockReturnValue(version);
      try {
        const screen = await render(<FloatingGlassBackground dark={dark} radius={32} />);
        const surface = screen.getByTestId("floating-glass-background");
        expect(surface).toHaveProp("glassEffectStyle", "regular");
        expect(surface).toHaveProp("colorScheme", mode);
        const layer = screen.queryByTestId("floating-glass-background-layer");
        if (reducedOpacity) expect(layer).toHaveStyle({ opacity: 0.9 });
        else expect(layer).toBeNull();
      } finally {
        systemVersion.mockRestore();
      }
    },
  );
});
