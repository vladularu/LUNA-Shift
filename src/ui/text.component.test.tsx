import { createRef } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TextInput as NativeTextInput } from "react-native";

import { Text, TextInput } from "@/ui/text";

describe("Inter native text", () => {
  it("resolves the final style weight while retaining text and accessibility", async () => {
    await render(
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={0}
        selectable
        style={[{ fontWeight: "400", fontSize: 18 }, { fontWeight: "600" }]}
      >
        Schicht bearbeiten
      </Text>,
    );
    const heading = screen.getByRole("header");
    expect(heading).toHaveStyle({ fontFamily: "Inter-SemiBold", fontSize: 18, fontWeight: "600" });
    expect(heading.props.selectable).toBe(true);
    expect(heading.props.maxFontSizeMultiplier).toBe(0);
  });

  it("preserves input callbacks, refs and the existing keyboard bridge", async () => {
    const onChangeText = jest.fn();
    const inputRef = createRef<TextInput>();
    await render(
      <TextInput
        ref={inputRef}
        accessibilityLabel="Notiz"
        onChangeText={onChangeText}
        style={{ fontWeight: "500" }}
        value=""
      />,
    );
    const input = screen.getByLabelText("Notiz");
    await fireEvent.changeText(input, "Spätdienst");
    expect(onChangeText).toHaveBeenCalledWith("Spätdienst");
    expect(input).toHaveStyle({ fontFamily: "Inter-Medium" });
    expect(inputRef.current).not.toBeNull();
    expect(TextInput.State).toBe(NativeTextInput.State);
  });
});
