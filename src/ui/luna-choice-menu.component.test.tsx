import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { SelectField } from "@/features/onboarding/onboarding-controls";

describe("LunaChoiceMenu", () => {
  it("forwards the selected iOS option for an inline onboarding field", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <SelectField
        compact
        label="100 % entsprechen"
        value={40}
        options={[
          { value: 40, label: "40 h" },
          { value: 38.5, label: "38,5 h" },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("onboarding-native-menu:100 % entsprechen")).toBeTruthy();
    const picker = screen.getByTestId("onboarding-native-options:100 % entsprechen");
    expect(picker.props.selection).toBe("40");
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: null } });
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: "38.5" } });
    expect(onChange).toHaveBeenCalledWith(38.5);
  });
});
