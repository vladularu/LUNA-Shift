import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
import { Text } from "@/ui/text";
import { CheckDetailDisclosure } from "./check-detail-disclosure";

describe("check detail disclosure", () => {
  it("keeps explanations and links initially closed behind an accessible 44pt action", async () => {
    const screen = await render(
      <CheckDetailDisclosure title="Quelle & Prüfgrenzen" testID="source-limit">
        <Text>Vertiefende Angaben</Text>
      </CheckDetailDisclosure>,
    );
    const button = screen.getByRole("button", { name: "Quelle & Prüfgrenzen", expanded: false });
    expect(button).toHaveStyle({ minHeight: 44 });
    expect(screen.queryByText("Vertiefende Angaben")).toBeNull();
    await fireEvent.press(button);
    expect(
      screen.getByRole("button", { name: "Quelle & Prüfgrenzen", expanded: true }),
    ).toBeVisible();
    expect(screen.getByText("Vertiefende Angaben")).toBeVisible();
    await fireEvent.press(button);
    expect(
      screen.getByRole("button", { name: "Quelle & Prüfgrenzen", expanded: false }),
    ).toBeVisible();
    expect(screen.queryByText("Vertiefende Angaben")).toBeNull();
  });
});
