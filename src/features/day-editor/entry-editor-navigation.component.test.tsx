import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router, Stack } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Pressable, Text } from "react-native";

import type { Appointment, ShiftEntry } from "@/domain/types";
import { DayEditorForm } from "@/features/day-editor/day-editor-form";
import { entryEditorScreenOptions } from "@/features/day-editor/entry-edit-presentation";
import { FeedbackProvider } from "@/ui/feedback";

const mockUpsertShift = jest.fn<() => Promise<ShiftEntry>>();
const mockUpsertAppointment = jest.fn<() => Promise<Appointment>>();

// Expo Router's test helper installs the upstream Reanimated mock, which omits this hook.
Object.assign(jest.requireMock<Record<string, unknown>>("react-native-reanimated"), {
  useReducedMotion: () => false,
});

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({
    entries: [],
    upsertShift: mockUpsertShift,
    upsertAppointment: mockUpsertAppointment,
    removeEntry: jest.fn(),
  }),
  usePflegeShiftProfile: () => ({ profile: null }),
  usePflegeShiftTemplates: () => ({ templates: [] }),
}));

jest.mock("@/application/rule-catalog-runtime-provider", () => {
  const { bundledRuleResolver } =
    jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver");
  return { useRuleCatalogRuntime: () => ({ resolver: bundledRuleResolver }) };
});

jest.mock("@/ui/haptics", () => ({
  deletionFeedback: jest.fn(),
  selectionFeedback: jest.fn(),
  successFeedback: jest.fn(),
  warningFeedback: jest.fn(),
}));

function Layout() {
  return (
    <FeedbackProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="shift-editor" options={entryEditorScreenOptions("ios", "#f3f3f6")} />
        <Stack.Screen
          name="appointment-editor"
          options={entryEditorScreenOptions("ios", "#f3f3f6")}
        />
      </Stack>
    </FeedbackProvider>
  );
}

function Home() {
  return (
    <>
      <Pressable onPress={() => router.push("/shift-editor")} accessibilityRole="button">
        <Text>Dienst öffnen</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/appointment-editor")} accessibilityRole="button">
        <Text>Termin öffnen</Text>
      </Pressable>
    </>
  );
}

function Shift() {
  return (
    <DayEditorForm
      date="2026-10-11"
      existing={null}
      onDeletionChange={() => {}}
      requestedMode="SHIFT"
      sessionKey="navigation-shift"
    />
  );
}

function AppointmentEditor() {
  return (
    <DayEditorForm
      date="2026-10-11"
      existing={null}
      onDeletionChange={() => {}}
      requestedMode="APPOINTMENT"
      sessionKey="navigation-appointment"
    />
  );
}

describe("entry editor with real Expo Router navigation", () => {
  beforeEach(() => {
    mockUpsertShift.mockReset().mockResolvedValue({ id: "saved" } as ShiftEntry);
    mockUpsertAppointment.mockReset().mockResolvedValue({ id: "saved" } as Appointment);
  });

  it.each([
    { kind: "Dienst", dismissal: "button", edited: false, saves: 1 },
    { kind: "Termin", dismissal: "button", edited: false, saves: 0 },
    { kind: "Dienst", dismissal: "navigation", edited: false, saves: 1 },
    { kind: "Termin", dismissal: "navigation", edited: false, saves: 0 },
    { kind: "Termin", dismissal: "button", edited: true, saves: 1 },
    { kind: "Termin", dismissal: "navigation", edited: true, saves: 1 },
  ])(
    "closes $kind via $dismissal with edited=$edited and $saves writes using real router contexts",
    async ({ kind, dismissal, edited, saves }) => {
      const screen = await renderRouter({
        _layout: Layout,
        index: Home,
        "shift-editor": Shift,
        "appointment-editor": AppointmentEditor,
      });
      await fireEvent.press(screen.getByRole("button", { name: `${kind} öffnen` }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Schließen und speichern" })).toBeTruthy(),
      );
      if (edited) await fireEvent.changeText(screen.getByLabelText("Titel"), "Arzttermin");
      if (dismissal === "navigation") await act(() => router.back());
      else await fireEvent.press(screen.getByRole("button", { name: "Schließen und speichern" }));
      await act(async () => {});
      await waitFor(() =>
        expect(screen.getByRole("button", { name: `${kind} öffnen` })).toBeTruthy(),
      );
      expect(kind === "Dienst" ? mockUpsertShift : mockUpsertAppointment).toHaveBeenCalledTimes(
        saves,
      );
    },
  );
});
