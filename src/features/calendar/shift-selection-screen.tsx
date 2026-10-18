import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import {
  usePflegeShiftEntries,
  usePflegeShiftStatus,
  usePflegeShiftTemplates,
} from "@/application/pflegeshift-provider";
import {
  buildQuickEntryActions,
  type QuickEntryStampAction,
} from "@/features/calendar/quick-entry-actions";
import { completeShiftSelectionNavigation } from "@/features/calendar/quick-entry-navigation";
import { ShiftSelectionPanel } from "@/features/calendar/shift-selection-panel";
import { useQuickEntrySelection } from "@/features/calendar/use-quick-entry-selection";
import { templateEditorRoute } from "@/navigation/routes";
import { parseLocalDateRouteParam, type RouteParam } from "@/navigation/route-params";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { useThemeStatusBar } from "@/ui/use-theme-status-bar";

export function ShiftSelectionScreen() {
  useThemeStatusBar();
  const params = useLocalSearchParams<{ date?: RouteParam }>();
  const parsedDate = parseLocalDateRouteParam(params.date);
  const { ready, error, reload } = usePflegeShiftStatus();
  const { templates } = usePflegeShiftTemplates();
  const { entries, upsertShift } = usePflegeShiftEntries();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const actions = useMemo(() => buildQuickEntryActions(templates), [templates]);
  const saveSelection = useQuickEntrySelection({
    entries,
    upsertShift,
    onBusyChange: setBusy,
    onError: (message) => setSaveError(message || null),
  });

  if (parsedDate.status === "invalid" || parsedDate.status === "missing") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der ausgewählte Kalendertag ist ungültig."
        onRetry={() => router.back()}
        title="Dienstauswahl nicht verfügbar"
      />
    );
  }
  if (!ready) return <LoadingView />;
  if (error) return <LoadFailureView message={error} onRetry={() => void reload()} />;

  const date = parsedDate.value;

  async function selectAction(action: QuickEntryStampAction, selectedDate: string) {
    const saved = await saveSelection(action, selectedDate);
    if (saved) {
      completeShiftSelectionNavigation();
      router.back();
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !busy }} />
      <ShiftSelectionPanel
        actions={actions}
        animateEntry={false}
        inNativeSheet
        busy={busy}
        date={date}
        errorMessage={saveError}
        onAddTemplate={() => router.replace(templateEditorRoute(undefined, date))}
        onClose={() => router.back()}
        onEditTemplate={(templateId) => router.replace(templateEditorRoute(templateId))}
        onSelectAction={(action, selectedDate) => void selectAction(action, selectedDate)}
      />
    </View>
  );
}
