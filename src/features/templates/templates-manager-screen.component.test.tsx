import { fireEvent, render, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";

import { TemplatesManagerScreen } from "@/features/templates/templates-manager-screen";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { RADII } from "@/theme/tokens";
import { FeedbackProvider } from "@/ui/feedback";

const mockMoveTemplate = jest.fn<() => Promise<void>>();
const mockRemoveTemplate = jest.fn<() => Promise<void>>();

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => void) => effect(),
}));

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ error: null, ready: true, reload: jest.fn() }),
  usePflegeShiftTemplates: () => ({
    templates: [
      {
        id: "early",
        name: "Früh",
        type: "EARLY",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 30,
        color: "#7954C7",
        symbol: "F",
        sortOrder: 10,
        revision: 1,
        deletedAt: null,
      },
      {
        id: "late",
        name: "Spät",
        type: "LATE",
        startTime: "14:00",
        endTime: "22:00",
        breakMinutes: 30,
        color: "#C94D5C",
        symbol: "S",
        sortOrder: 20,
        revision: 1,
        deletedAt: null,
      },
    ],
    moveTemplateToIndex: mockMoveTemplate,
    removeTemplate: mockRemoveTemplate,
  }),
}));

const mockPush = jest.mocked(router.push);

describe("TemplatesManagerScreen", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockMoveTemplate.mockClear();
    mockRemoveTemplate.mockClear();
  });

  it("opens a template directly when its row is pressed", async () => {
    const screen = await render(
      <FeedbackProvider>
        <TemplatesManagerScreen />
      </FeedbackProvider>,
    );

    await fireEvent.press(screen.getByText("Früh"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/template-editor",
      params: { id: "early" },
    });
    expect(screen.queryByText("Meine Dienste")).toBeNull();
    expect(screen.getByTestId("templates-manager-scroll").props.contentContainerStyle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: "100%", maxWidth: 560, alignSelf: "center" }),
      ]),
    );
    expect(screen.getByTestId("template-manager-list")).toHaveStyle({
      borderRadius: RADII.card,
    });
    expect(screen.getByTestId("template-manager-row-early")).toHaveStyle({ minHeight: 68 });
    expect(screen.getByTestId("template-manager-row-early-badge")).toHaveStyle({
      width: 30,
      height: 30,
      borderRadius: RADII.pill,
    });
    expect(screen.queryByRole("button", { name: "Früh bearbeiten" })).toBeNull();
    expect(screen.queryByTestId("template-manager-add-button")).toBeNull();
    expect(screen.getByTestId("template-manager-add-row")).toHaveStyle({ minHeight: 64 });
    await fireEvent.press(screen.getByRole("button", { name: "Neue Dienstvorlage erstellen" }));
    expect(mockPush).toHaveBeenCalledWith("/template-editor");
  });

  it("uses the accent sort toggle and confines move actions to sort mode", async () => {
    const screen = await render(
      <FeedbackProvider>
        <TemplatesManagerScreen />
      </FeedbackProvider>,
    );

    expect(screen.queryByRole("button", { name: "Nach unten" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Vorlagen sortieren" }));
    expect(screen.getByTestId("template-manager-sort-button")).toHaveStyle({
      backgroundColor: LIGHT_PALETTE.sortAction,
    });
    expect(screen.queryByTestId("template-manager-add-row")).toBeNull();
    await fireEvent(screen.getByTestId("template-manager-sort-row-early"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(mockMoveTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "early" }), 1);
    await fireEvent.press(screen.getByRole("button", { name: "Sortieren beenden" }));
    expect(screen.getByTestId("template-manager-add-row")).toBeVisible();
  });

  it("has one editing action per template row without inline deletion", async () => {
    const screen = await render(
      <FeedbackProvider>
        <TemplatesManagerScreen />
      </FeedbackProvider>,
    );

    for (const id of ["early", "late"]) {
      expect(
        within(screen.getByTestId(`template-manager-row-${id}`)).getAllByRole("button"),
      ).toHaveLength(1);
    }
    expect(screen.queryByRole("button", { name: "Früh bearbeiten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Spät bearbeiten" })).toBeNull();
    await fireEvent.press(
      within(screen.getByTestId("template-manager-row-early")).getByRole("button"),
    );

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/template-editor",
      params: { id: "early" },
    });
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();
    expect(mockRemoveTemplate).not.toHaveBeenCalled();
  });
});
