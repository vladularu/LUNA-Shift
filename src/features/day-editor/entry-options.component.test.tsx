import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NotificationSheet } from "@/features/day-editor/entry-options";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";

async function renderNotificationSheet(
  overrides: Partial<React.ComponentProps<typeof NotificationSheet>> = {},
) {
  const props: React.ComponentProps<typeof NotificationSheet> = {
    deferredSelection: true,
    onChange: jest.fn(),
    onClose: jest.fn(),
    value: null,
    ...overrides,
  };
  const screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 430, height: 932 },
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
      }}
    >
      <NotificationSheet {...props} />
    </SafeAreaProvider>,
  );
  return { props, screen };
}

describe("NotificationSheet", () => {
  it.each([false, true])("keeps the confirmation action blue in dark=%s", async (dark) => {
    jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
    const { screen } = await renderNotificationSheet();
    expect(screen.getByRole("button", { name: "Erinnerung übernehmen" })).toHaveStyle({
      backgroundColor: palette.primaryAction,
    });
    expect(screen.getByText("Fertig")).toHaveStyle({ color: palette.onPrimaryAction });
  });

  it("keeps the reference choices local until the user confirms them", async () => {
    const { props, screen } = await renderNotificationSheet();

    expect(screen.getByRole("radio", { name: "Keine", checked: true })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Erinnerungsabstand"), "2");
    await fireEvent.press(screen.getByRole("radio", { name: "Stunden" }));
    await fireEvent.press(screen.getByRole("radio", { name: "nach" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Ende" }));

    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung übernehmen" }));
    expect(props.onChange).toHaveBeenCalledWith({
      amount: 2,
      unit: "HOUR",
      direction: "AFTER",
      reference: "END",
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms Keine instead of closing the sheet immediately", async () => {
    const { props, screen } = await renderNotificationSheet({
      value: { amount: 15, unit: "MINUTE", direction: "BEFORE", reference: "START" },
    });

    await fireEvent.press(screen.getByRole("radio", { name: "Keine" }));
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Erinnerung übernehmen" }));
    expect(props.onChange).toHaveBeenCalledWith(null);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
