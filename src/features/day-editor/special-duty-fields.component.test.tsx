import { useState } from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
import { newSpecialDuty, type SpecialDuty } from "@/domain/special-duty";
import { SpecialDutyFields } from "./special-duty-fields";

function Harness({ initial = null }: { readonly initial?: SpecialDuty | null }) {
  const [value, setValue] = useState(initial);
  return (
    <SpecialDutyFields
      value={value}
      onChange={setValue}
      startTime="06:00"
      endTime="10:00"
      timeZone="Europe/Berlin"
    />
  );
}

describe("special duty editor", () => {
  it("adds and removes a linked second part in the existing editor", async () => {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByLabelText("Weiteren Dienstteil hinzufügen"));
    expect(screen.getByText("Geteilter Dienst")).toBeTruthy();
    expect(screen.getByLabelText("Dienstteil 2 entfernen")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Dienstteil 2 entfernen"));
    expect(screen.queryByLabelText("Dienstteil 2 entfernen")).toBeNull();
  });
  it("adds an actual callout and keeps its completion separate", async () => {
    const screen = await render(
      <Harness initial={newSpecialDuty("ON_CALL", "06:00", "10:00", "Europe/Berlin")} />,
    );
    await fireEvent.press(screen.getByLabelText("Einsatz hinzufügen"));
    expect(screen.getByText("Telefonisch / von zu Hause")).toBeTruthy();
    expect(screen.getByText("Noch nicht abgeschlossen")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Einsatz 1 entfernen"));
    expect(screen.queryByLabelText("Einsatz 1 entfernen")).toBeNull();
  });
});
