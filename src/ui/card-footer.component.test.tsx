import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { View } from "react-native";

import { AnalysisListCard } from "@/features/analysis/analysis-list-card";
import { WorktimeCard } from "@/features/analysis/worktime-card";
import { Text } from "@/ui/text";

let mockFontScale = 1;
jest.mock("react-native", () => {
  const native = jest.requireActual<typeof import("react-native")>("react-native");
  return Object.defineProperty(Object.create(native), "useWindowDimensions", {
    value: () => ({ width: 393, height: 852, scale: 3, fontScale: mockFontScale }),
  });
});

describe("shared LUNA card info area", () => {
  it.each([1, 2])(
    "reserves the same lower area with and without info at font scale %s",
    async (scale) => {
      mockFontScale = scale;
      const open = jest.fn();
      await render(
        <>
          <View testID="empty-card">
            <AnalysisListCard title="Schichten" onPress={open}>
              <Text>Gesamt 20</Text>
            </AnalysisListCard>
          </View>
          <View testID="info-card">
            <AnalysisListCard title="Gehalt" caption="Zulagen aus Oktober 2026">
              <Text>Beispielbetrag</Text>
            </AnalysisListCard>
          </View>
        </>,
      );
      const empty = within(screen.getByTestId("empty-card"));
      const info = within(screen.getByTestId("info-card"));
      const emptyZone = empty.getByTestId("card-info-zone");
      const infoZone = info.getByTestId("card-info-zone");
      expect(emptyZone.props.style).toEqual(infoZone.props.style);
      expect(emptyZone.props.style.minHeight).toBeGreaterThanOrEqual(scale === 1 ? 44 : 58);
      expect(empty.queryByTestId("analysis-card-caption")).toBeNull();
      expect(within(infoZone).getByText("Zulagen aus Oktober 2026")).toBeTruthy();
      expect(empty.getByTestId("card-footer")).toHaveStyle({ marginHorizontal: 16 });
      expect(info.getByTestId("card-footer")).toHaveStyle({ marginHorizontal: 16 });
      expect(within(emptyZone).queryByRole("button")).toBeNull();
      await fireEvent.press(empty.getByRole("button", { name: "Schichten: Details öffnen" }));
      expect(open).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the same footer for work-time notes and keeps long text free to wrap", async () => {
    mockFontScale = 1;
    const caption =
      "Grundlage: 5-Tage-Woche im Schichtdienst. Zusätzlicher Hinweis zur Arbeitszeit.";
    await render(
      <WorktimeCard
        target="161:42"
        actual="163:00"
        balance="+1:18"
        balanceAccent="#15803D"
        caption={caption}
      />,
    );
    const zone = screen.getByTestId("card-info-zone");
    const note = within(zone).getByText(caption);
    expect(note.props.numberOfLines).toBeUndefined();
    expect(zone.props.style.height).toBeUndefined();
    expect(zone.props.style.minHeight).toBe(44);
    expect(within(zone).queryByRole("button")).toBeNull();
  });
});
