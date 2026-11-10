import { describe, expect, it, jest } from "@jest/globals";
import { render, within } from "@testing-library/react-native";
import type { ShiftEntry } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";
import * as DesignSystem from "@/ui/design-system";
import { AffectedCheckShifts } from "./compliance-issue-content";

let mockFontScale = 1;
let mockWidth = 320;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const duty = (date: string, change: Partial<ShiftEntry> = {}): ShiftEntry => ({
  kind: "SHIFT",
  id: date,
  templateId: null,
  date,
  title: "Tag",
  type: "DAY",
  startTime: "08:00",
  endTime: "16:12",
  breakMinutes: 30,
  color: "#227766",
  symbol: "T",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
  ...change,
});

describe("compact affected duties", () => {
  it("sorts every shared detail list by date and start time without changing its input", async () => {
    const entries = Object.freeze([
      duty("2027-01-01", { id: "first-input" }),
      duty("2026-08-30", { id: "second-input" }),
      duty("2026-08-23", { id: "late", startTime: "21:00", endTime: "07:30" }),
      duty("2026-08-23", { id: "early", startTime: "07:00" }),
      duty("2026-12-31", { id: "year-end", startTime: "21:00", endTime: "07:30" }),
    ]);
    const before = JSON.stringify(entries);
    const screen = await render(<AffectedCheckShifts shifts={entries} />);

    expect(screen.getAllByTestId(/^check-duty-symbol-/).map((row) => row.props.testID)).toEqual([
      "check-duty-symbol-2026-08-23-early",
      "check-duty-symbol-2026-08-23-late",
      "check-duty-symbol-2026-08-30-second-input",
      "check-duty-symbol-2026-12-31-year-end",
      "check-duty-symbol-2027-01-01-first-input",
    ]);
    expect(JSON.stringify(entries)).toBe(before);
  });
  it("labels the parent window of a split duty as partial rather than a full duty period", async () => {
    const split = duty("2026-11-29", {
      title: "Geteilter Dienst",
      startTime: "16:00",
      endTime: "20:00",
      specialDuty: {
        ...newSpecialDuty("SPLIT", "16:00", "20:00", "Europe/Berlin"),
        parts: [{ start: 1410, end: 1530, breakMinutes: 0 }],
      },
    });
    const screen = await render(<AffectedCheckShifts shifts={[split]} />);

    expect(screen.getByTestId(`check-shift-${split.id}`).props.accessibilityLabel).toContain(
      "eingetragenes Zeitfenster",
    );
    expect(screen.queryByText(/16:00–20:00/)).toBeNull();
  });
  it("shows the actual colored duty symbols without visible times or an expandable table", async () => {
    const entries = Array.from({ length: 6 }, (_, index) =>
      duty(`2026-11-${24 + index}`, { color: index % 2 ? "#123456" : "#AABBCC" }),
    );
    const badgeSpy = jest.spyOn(DesignSystem, "ColorBadge");
    try {
      const screen = await render(<AffectedCheckShifts shifts={entries} />);
      expect(screen.queryByRole("button", { name: /Dienste (anzeigen|ausblenden)/ })).toBeNull();
      for (const entry of entries) {
        expect(screen.getByTestId(`check-duty-symbol-${entry.date}-${entry.id}`)).toBeVisible();
        expect(badgeSpy.mock.calls.map(([props]) => props)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ color: entry.color, label: entry.symbol, size: 18 }),
          ]),
        );
      }
      expect(screen.queryByText("Uhrzeit")).toBeNull();
      expect(screen.queryByText(/08:00/)).toBeNull();
    } finally {
      badgeSpy.mockRestore();
    }
  });

  it("explains a night crossing midnight without hiding the end date from VoiceOver", async () => {
    const night = duty("2026-11-29", {
      title: "Nacht",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:30",
    });
    const screen = await render(<AffectedCheckShifts shifts={[night]} />);

    const row = screen.getByTestId(`check-shift-${night.id}`);
    expect(within(row).queryByText("21:00–07:30 +1")).toBeNull();
    expect(row.props.accessibilityLabel).toContain("29. November 2026");
    expect(row.props.accessibilityLabel).toContain("30. November 2026");
  });

  it("keeps long duty names and times available with large text", async () => {
    mockFontScale = 1.7;
    try {
      const entry = duty("2026-12-31", {
        title: "Sehr langer Dienst auf der Intensivstation",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
      });
      const screen = await render(<AffectedCheckShifts shifts={[entry, duty("2027-01-02")]} />);

      expect(screen.getByText(entry.title)).toBeVisible();
      expect(screen.queryByText("21:00–07:30 +1")).toBeNull();
      expect(screen.getByTestId(`check-shift-${entry.id}`).props.accessibilityLabel).toContain(
        "1. Januar 2027",
      );
    } finally {
      mockFontScale = 1;
    }
  });
  it("keeps seven equal columns with an incomplete final row at standard and large font sizes", async () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      duty(`2026-11-${String(index + 1).padStart(2, "0")}`),
    );
    mockWidth = 393;
    try {
      const screen = await render(<AffectedCheckShifts shifts={entries} />);
      const first = screen.getByTestId("check-affected-shifts-2026-11-01");
      const lastRow = screen.getByTestId("check-affected-shifts-2026-11-08");
      expect(first).toHaveStyle({ flex: 1, minWidth: 0 });
      expect(lastRow).toHaveStyle({ flex: 1, minWidth: 0 });
      expect(first.parent?.children).toHaveLength(7);
      expect(lastRow.parent?.children).toHaveLength(7);
      expect(
        screen.getAllByTestId(/^check-affected-shifts-spacer-/, { includeHiddenElements: true }),
      ).toHaveLength(4);
      for (const spacer of screen.getAllByTestId(/^check-affected-shifts-spacer-/, {
        includeHiddenElements: true,
      })) {
        expect(spacer).toHaveStyle({ flex: 1, minWidth: 0 });
        expect(spacer.props.accessibilityElementsHidden).toBe(true);
      }
      mockFontScale = 1.7;
      await screen.rerender(<AffectedCheckShifts shifts={entries} />);
      expect(screen.getByTestId("check-affected-shifts-2026-11-01")).toHaveStyle({
        minWidth: 52 * 1.7,
      });
      expect(screen.getByTestId("check-affected-shifts-2026-11-08")).toHaveStyle({
        minWidth: 52 * 1.7,
      });
      expect(screen.getByLabelText("Betroffene Tage, horizontal scrollbar")).toBeVisible();
    } finally {
      mockWidth = 320;
      mockFontScale = 1;
    }
  });
});
