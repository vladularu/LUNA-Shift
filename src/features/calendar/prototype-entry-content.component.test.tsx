import { render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import type { ShiftEntry } from "@/domain/types";
import { PrototypeEntryContent } from "./prototype-entry-content";
import { calendarChipPalette } from "@/theme/color-contrast";

jest.mock("@/ui/shift-symbol", () => ({ ShiftSymbol: () => null }));
const shift: ShiftEntry = {
  kind: "SHIFT",
  id: "real",
  date: "2026-09-09",
  templateId: null,
  title: "Früh",
  type: "EARLY",
  startTime: "07:00",
  endTime: "15:00",
  breakMinutes: 30,
  color: "#348765",
  symbol: "sunrise",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};
describe("prototype real shift content", () => {
  it.each([false, true])(
    "follows later preset and custom edits in pastel mode, dark=%s",
    async (dark) => {
      const scheme = jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const display = {
        labelMode: "FULL",
        showShiftTimes: true,
        showShiftDuration: false,
        pastelColors: true,
      } as const;
      const content = (color: string, pastelColors = true) => (
        <PrototypeEntryContent
          entry={Object.freeze({ ...shift, color })}
          display={{ ...display, pastelColors }}
          timeZone="Europe/Berlin"
        />
      );
      const screen = await render(content("#59CA50"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#DDF4D9" });
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#171719" });
      await screen.rerender(content("#4FCB68"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#DDF4E2" });
      await screen.rerender(content("#F05C68"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#F9DDE0" });
      await screen.rerender(content("#e74c55"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#F8D8DA" });
      await screen.rerender(content("#123456"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#E1E6EA" });
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#171719" });
      await screen.rerender(content("#F1EECE"));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#F4F1D7" });
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#171719" });
      await screen.rerender(content("#FFFFFF"));
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#171719" });
      await screen.rerender(content("#123456", false));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#123456" });
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#FFFFFF" });
      await screen.rerender(content("#E74C55", false));
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: "#E74C55" });
      scheme.mockRestore();
    },
  );

  it("uses a compact separate dot and the full appointment title for width-based truncation", async () => {
    const screen = await render(
      <PrototypeEntryContent
        entry={{
          ...shift,
          kind: "APPOINTMENT",
          allDay: false,
          title: "Ohne Titel",
          recurrence: null,
        }}
        display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
        timeZone="Europe/Berlin"
      />,
    );
    const title = screen.getByText("Ohne Titel");
    expect(title).toHaveProp("numberOfLines", 1);
    expect(title).toHaveProp("ellipsizeMode", "tail");
    expect(title).toHaveStyle({ flex: 1, minWidth: 0, fontSize: 12, fontWeight: "500" });
    expect(title.parent).toHaveStyle({ height: 17 });
    expect(title.parent?.children).toHaveLength(2);
    expect(screen.queryByText("07:00")).toBeNull();
  });

  it.each([
    ["#59CA50", false],
    ["#FFA338", false],
    ["#59CA50", true],
    ["#FFA338", true],
  ] as [string, boolean][])(
    "keeps %s with white title and reference time contrast in dark=%s",
    async (color, dark) => {
      const scheme = jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const screen = await render(
        <PrototypeEntryContent
          entry={{ ...shift, color }}
          display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
          timeZone="Europe/Berlin"
        />,
      );
      expect(screen.getByText("Früh")).toHaveStyle({ color: "#FFFFFF" });
      expect(screen.getByText("07:00")).toHaveStyle({
        color: dark ? "#FFFFFF" : "#171719",
        backgroundColor: calendarChipPalette(color, dark).detail,
      });
      expect(screen.getByText("Früh").parent).toHaveStyle({ backgroundColor: color });
      expect(screen.getByText("Früh").parent?.parent).toHaveStyle({ borderRadius: 2 });
      scheme.mockRestore();
    },
  );
  it("honors title, time and duration options without entrance animations", async () => {
    const screen = await render(
      <PrototypeEntryContent
        entry={shift}
        display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: false }}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getByText("Früh")).toBeTruthy();
    expect(screen.getByText("07:00")).toBeTruthy();
    await screen.rerender(
      <PrototypeEntryContent
        entry={shift}
        display={{ labelMode: "SHORT", showShiftTimes: false, showShiftDuration: false }}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getByText("F")).toBeTruthy();
    expect(screen.queryByText("07:00")).toBeNull();
    await screen.rerender(
      <PrototypeEntryContent
        entry={shift}
        display={{ labelMode: "SYMBOL", showShiftTimes: false, showShiftDuration: true }}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.queryByText("F")).toBeNull();
    expect(screen.getByText("7:30 h")).toBeTruthy();
  });
  it("shows GT instead of a time for all-day shifts", async () => {
    const screen = await render(
      <PrototypeEntryContent
        entry={{ ...shift, allDay: true, startTime: null, endTime: null }}
        display={{ labelMode: "FULL", showShiftTimes: true, showShiftDuration: true }}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getByText("Früh")).toBeTruthy();
    expect(screen.getByText("GT")).toBeTruthy();
    expect(screen.queryByText(/07:00|7:30/)).toBeNull();
  });
});
