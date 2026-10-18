import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import {
  usePflegeShiftEntries,
  usePflegeShiftStatus,
  usePflegeShiftTemplates,
} from "@/application/pflegeshift-provider";
import { today } from "@/engine/calendar";
import {
  buildQuickEntryActions,
  type QuickEntryStampAction,
} from "@/features/calendar/quick-entry-actions";
import { useQuickEntrySelection } from "@/features/calendar/use-quick-entry-selection";
import { ShiftSelectionPanel } from "@/features/calendar/shift-selection-panel";
import { parseLocalDateRouteParam, type RouteParam } from "@/navigation/route-params";
import { templateEditorRoute } from "@/navigation/routes";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { useThemeStatusBar } from "@/ui/use-theme-status-bar";

export function QuickAddScreen() {
  useThemeStatusBar();
  const params = useLocalSearchParams<{ date?: RouteParam }>();
  const { templates } = usePflegeShiftTemplates();
  const { entries, upsertShift } = usePflegeShiftEntries();
  const { error: loadError, ready, reload } = usePflegeShiftStatus();
  const parsedDate = parseLocalDateRouteParam(params.date);
  const date = parsedDate.status === "valid" ? parsedDate.value : today();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const actions = useMemo(() => buildQuickEntryActions(templates), [templates]);
  const saveSelection = useQuickEntrySelection({
    entries,
    upsertShift,
    onBusyChange: setSaving,
    onError: (message) => setError(message || null),
  });

  if (parsedDate.status !== "valid") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zur Schnellauswahl enthält kein gültiges Datum."
        onRetry={() => router.back()}
        title="Schnellauswahl kann nicht geöffnet werden"
      />
    );
  }
  if (ready && loadError) {
    return <LoadFailureView message={loadError} onRetry={() => void reload()} />;
  }
  if (!ready) return <LoadingView />;

  async function saveTemplate(action: QuickEntryStampAction, selectedDate: string) {
    const saved = await saveSelection(action, selectedDate);
    if (saved) router.back();
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ShiftSelectionPanel
        actions={actions}
        animateEntry={false}
        busy={saving}
        date={date}
        errorMessage={error}
        onAddTemplate={() => router.replace(templateEditorRoute(undefined, date))}
        onClose={() => router.back()}
        onEditTemplate={(templateId) => router.replace(templateEditorRoute(templateId))}
        onSelectAction={(action, selectedDate) => void saveTemplate(action, selectedDate)}
      />
    </View>
  );
}
