import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { OnboardingBrand } from "./onboarding-brand";
import { OnboardingReveal, useOnboardingReducedMotion } from "./onboarding-motion";
import { Text } from "@/ui/text";

let mockPalette = LIGHT_PALETTE;
jest.mock("@/theme/palette", () => ({ usePalette: () => mockPalette }));
beforeEach(() => {
  mockPalette = LIGHT_PALETTE;
  jest.restoreAllMocks();
});

describe("theme-aware onboarding identity", () => {
  it("keeps page content in position and never rewinds an already visible page", async () => {
    jest
      .spyOn(Animated, "timing")
      .mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
    const page = (name: string, reduced: boolean) => (
      <OnboardingReveal key={name} variant="page" reduced={reduced} testID="page">
        <Text>{name}</Text>
      </OnboardingReveal>
    );
    const screen = await render(page("Plan", true));
    await screen.rerender(page("Plan", false));
    expect(screen.getByTestId("page")).toHaveStyle({ opacity: 1 });
    await screen.rerender(page("Zusammenfassung", false));
    const surface = screen.getByTestId("page");
    expect(surface).toHaveStyle({ opacity: 0.85 });
    expect(StyleSheet.flatten(surface.props.style).transform).toBeUndefined();
    await screen.rerender(page("Zusammenfassung", true));
    expect(screen.getByTestId("page")).toHaveStyle({ opacity: 1 });
  });
  it("keeps an accessible identity and selects the supplied logo for each theme", async () => {
    const screen = await render(<OnboardingBrand reduced />);
    expect(screen.getByRole("image", { name: "LUNA Shift" })).toBeTruthy();
    expect(screen.getByText("Schichtdienst ist kompliziert genug.")).toBeTruthy();
    expect(screen.getByText("Dein Dienstplan sollte es nicht sein.")).toBeTruthy();
    const image = screen.getByTestId("onboarding-brand-image");
    expect(image.props.source).toEqual(
      require("../../../assets/brand/lunashift/logo-horizontal-light.png"),
    );
    expect(image.props.resizeMode).toBe("contain");
    mockPalette = DARK_PALETTE;
    await screen.rerender(<OnboardingBrand reduced />);
    expect(screen.getByTestId("onboarding-brand-image").props.source).toEqual(
      require("../../../assets/brand/lunashift/logo-horizontal-dark.png"),
    );
  });
  it("honors a live reduced-motion change without a stale initial read overriding it", async () => {
    let notify: (value: boolean) => void = () => {};
    let resolveInitial: (value: boolean) => void = () => {};
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
    );
    const remove = jest.fn();
    const listen = ((_name: string, callback: (value: boolean) => void) => {
      notify = callback;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener;
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(listen);
    function Example() {
      const reduced = useOnboardingReducedMotion();
      return (
        <OnboardingReveal reduced={reduced} testID="reveal">
          <Text>{reduced ? "Reduziert" : "Animiert"}</Text>
        </OnboardingReveal>
      );
    }
    const screen = await render(<Example />);
    expect(screen.getByText("Reduziert")).toBeTruthy();
    await act(async () => {
      notify(true);
      resolveInitial(false);
    });
    expect(screen.getByText("Reduziert")).toBeTruthy();
    expect(screen.getByTestId("reveal")).toHaveStyle({ opacity: 1 });
    await act(async () => notify(false));
    await waitFor(() => expect(screen.getByText("Animiert")).toBeTruthy());
    await act(async () => notify(true));
    expect(screen.getByTestId("reveal")).toHaveStyle({ opacity: 1 });
    await screen.unmount();
    expect(remove).toHaveBeenCalled();
  });
});
