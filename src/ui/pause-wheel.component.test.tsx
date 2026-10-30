import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { useState } from "react";

import { PauseWheel } from "@/ui/pause-wheel";
import { PausePicker } from "@/ui/pause-picker";

describe("PauseWheel", () => {
  it("keeps the controlled five-step pause contract for taps and scrolling", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <PauseWheel
        onChange={onChange}
        selectionTestID="pause-selection"
        testID="pause-wheel"
        value={30}
      />,
    );

    expect(screen.getByTestId("pause-selection")).toHaveStyle({ height: 44 });
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(
      screen.getByRole("radio", { name: "30 Minuten" }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    const wheel = screen.getByTestId("pause-wheel");
    await fireEvent(wheel, "scrollEndDrag", {
      nativeEvent: {
        contentOffset: { x: 0, y: 88 },
        targetContentOffset: { x: 0, y: 88 },
      },
    });
    expect(onChange).toHaveBeenLastCalledWith(30);

    await fireEvent(wheel, "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 0, y: 132 } },
    });
    expect(onChange).toHaveBeenLastCalledWith(45);
    expect(
      screen.getByRole("radio", { name: "45 Minuten" }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole("radio", { name: "60 Minuten" }));
    expect(onChange).toHaveBeenLastCalledWith(60);
    expect(screen.queryByRole("radio", { name: "75 Minuten" })).toBeNull();
  });

  it("starts on the nearest supported step for a legacy custom value", async () => {
    const onChange = jest.fn();
    const screen = await render(<PauseWheel onChange={onChange} value={37} />);

    expect(
      screen.getByRole("radio", { name: "30 Minuten" }).props.accessibilityState,
    ).toMatchObject({ selected: true });

    await fireEvent(screen.getByLabelText("Pausendauer in 15-Minuten-Schritten"), "scrollEndDrag", {
      nativeEvent: { contentOffset: { x: 0, y: 44 } },
    });
    expect(onChange).toHaveBeenCalledWith(15);
  });
});

describe("shared pause picker", () => {
  function Harness({ initial = "30" }: { readonly initial?: string }) {
    const [value, setValue] = useState(initial);
    return <PausePicker value={value} onChange={setValue} />;
  }

  it("opens the familiar wheel and changes the duration only after deliberate selection", async () => {
    const changed = jest.fn();
    const screen = await render(<PausePicker value="30" onChange={changed} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 30 Minuten" }));
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(changed).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("radio", { name: "45 Minuten" }));
    expect(changed).toHaveBeenCalledWith("45");
  });

  it("preserves exact stored minutes when opening and keeps the selection stable after changing", async () => {
    const screen = await render(<Harness initial="7" />);
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 7 Minuten" }));
    expect(screen.getByRole("radio", { name: "7 Minuten" })).toHaveProp("accessibilityState", {
      selected: true,
    });
    expect(screen.getByRole("button", { name: "Pause: 7 Minuten" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "15 Minuten" }));
    expect(screen.getByRole("radio", { name: "15 Minuten" })).toHaveProp("accessibilityState", {
      selected: true,
    });
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 15 Minuten" }));
    await fireEvent.press(screen.getByRole("button", { name: "Pause: 15 Minuten" }));
    expect(screen.queryByRole("radio", { name: "7 Minuten" })).toBeNull();
    expect(screen.getByRole("radio", { name: "15 Minuten" })).toHaveProp("accessibilityState", {
      selected: true,
    });
  });
});
