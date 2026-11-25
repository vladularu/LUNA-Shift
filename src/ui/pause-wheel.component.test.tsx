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

  it("previews animated scrolling and reports the snapped selection once", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <PauseWheel animatedOptions onChange={onChange} testID="animated-pause-wheel" value={0} />,
    );
    const wheel = screen.getByTestId("animated-pause-wheel");
    const beforeSnap = { x: 0, y: 72 };
    const snapped = { x: 0, y: 88 };

    await fireEvent.scroll(wheel, { nativeEvent: { contentOffset: beforeSnap } });
    expect(screen.getByRole("radio", { name: "0 Minuten", selected: true })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent(wheel, "scrollEndDrag", {
      nativeEvent: { contentOffset: beforeSnap, targetContentOffset: snapped },
    });
    await fireEvent(wheel, "momentumScrollEnd", { nativeEvent: { contentOffset: snapped } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(30);
    expect(screen.getByRole("radio", { name: "30 Minuten", selected: true })).toBeTruthy();

    await fireEvent.press(screen.getByRole("radio", { name: "45 Minuten" }));
    expect(onChange).toHaveBeenLastCalledWith(45);
    expect(screen.getByRole("radio", { name: "45 Minuten", selected: true })).toBeTruthy();
  });
});

describe("shared pause picker", () => {
  function Harness({ initial = "30" }: { readonly initial?: string }) {
    const [value, setValue] = useState(initial);
    return <PausePicker value={value} onChange={setValue} />;
  }

  it("offers five native choices and changes only after a deliberate selection", async () => {
    const changed = jest.fn();
    const screen = await render(<PausePicker value="30" onChange={changed} />);
    const picker = screen.getByTestId("pause-options");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByTestId(/^pause-option:/)).toHaveLength(5);
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: null } });
    expect(changed).not.toHaveBeenCalled();
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: "45" } });
    expect(changed).toHaveBeenCalledWith("45");
  });

  it("preserves exact stored minutes and falls back to the standard choices after changing", async () => {
    const screen = await render(<Harness initial="7" />);
    const picker = screen.getByTestId("pause-options");
    expect(picker).toHaveProp("selection", "7");
    expect(screen.getByTestId("pause-option:7 Min.")).toBeTruthy();
    await fireEvent(picker, "selectionChange", { nativeEvent: { selection: "15" } });
    expect(screen.queryByTestId("pause-option:7 Min.")).toBeNull();
    expect(screen.getByTestId("pause-options")).toHaveProp("selection", "15");
  });
});
