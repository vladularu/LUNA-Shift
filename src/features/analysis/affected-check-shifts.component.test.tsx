import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, within } from "@testing-library/react-native";
import type { ShiftEntry } from "@/domain/types";
import { newSpecialDuty } from "@/domain/special-duty";
import { AffectedCheckShifts } from "./compliance-issue-content";

let mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 320, height: 844, scale: 3, fontScale: mockFontScale }),
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
    await fireEvent.press(screen.getByRole("button", { name: "1 Dienst anzeigen" }));
    expect(screen.getByTestId(`check-shift-${split.id}`).props.accessibilityLabel).toContain(
      "eingetragenes Zeitfenster",
    );
    expect(screen.getByText(/16:00–20:00.*Teilzeiten/)).toBeVisible();
  });
  it("starts six duties collapsed and lets the user reveal and hide the compact rows", async () => {
    const entries = Array.from({ length: 6 }, (_, index) => duty(`2026-11-${24 + index}`));
    const screen = await render(<AffectedCheckShifts shifts={entries} />);
    expect(
      screen.getByRole("button", { name: "6 Dienste anzeigen", expanded: false }),
    ).toBeVisible();
    expect(screen.queryByTestId("check-shift-2026-11-24")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "6 Dienste anzeigen" }));
    expect(
      screen.getByRole("button", { name: "6 Dienste ausblenden", expanded: true }),
    ).toBeVisible();
    for (const entry of entries)
      expect(screen.getByTestId(`check-shift-${entry.id}`)).toBeVisible();
    expect(screen.getByText("Datum")).toBeVisible();
    expect(screen.getByText("Dienst")).toBeVisible();
    expect(screen.getByText("Uhrzeit")).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "6 Dienste ausblenden" }));
    expect(screen.queryByTestId("check-shift-2026-11-24")).toBeNull();
  });

  it("explains a night crossing midnight without hiding the end date from VoiceOver", async () => {
    const night = duty("2026-11-29", {
      title: "Nacht",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:30",
    });
    const screen = await render(<AffectedCheckShifts shifts={[night]} />);
    await fireEvent.press(screen.getByRole("button", { name: "1 Dienst anzeigen" }));
    const row = screen.getByTestId(`check-shift-${night.id}`);
    expect(within(row).getByText("21:00–07:30 +1")).toBeVisible();
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
      await fireEvent.press(screen.getByRole("button", { name: "2 Dienste anzeigen" }));
      expect(screen.getByText(entry.title)).toBeVisible();
      expect(screen.getByText("21:00–07:30 +1")).toBeVisible();
      expect(screen.getByTestId(`check-shift-${entry.id}`).props.accessibilityLabel).toContain(
        "1. Januar 2027",
      );
    } finally {
      mockFontScale = 1;
    }
  });
});
