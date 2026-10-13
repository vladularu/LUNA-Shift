import Ionicons from "@/ui/icon";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { usePflegeShiftStatus, usePflegeShiftTemplates } from "@/application/pflegeshift-provider";
import { userFacingErrorMessage } from "@/domain/errors";
import {
  ShiftTemplateAddRow,
  ShiftTemplateListCard,
  ShiftTemplateListRow,
  ShiftTemplateListSeparator,
  shiftTemplateSubtitle,
} from "@/features/templates/shift-template-list";
import { usePalette } from "@/theme/palette";
import { templateEditorRoute } from "@/navigation/routes";
import { RADII, SPACING } from "@/theme/tokens";
import { ReorderableList } from "@/ui/reorderable-list";
import { useReorderScroll } from "@/ui/use-reorder-scroll";
import { ColorBadge, EmptyState } from "@/ui/design-system";
import { FormStatus } from "@/ui/form-layout";
import { selectionFeedback } from "@/ui/haptics";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ScreenScrollView } from "@/ui/screen-layout";
import { TabRootHeader } from "@/ui/tab-root-header";
import { useThemeStatusBar } from "@/ui/use-theme-status-bar";

export function TemplatesManagerScreen() {
  const palette = usePalette();
  useThemeStatusBar();
  const reorderScroll = useReorderScroll();
  const { error: loadError, ready, reload } = usePflegeShiftStatus();
  const { templates, moveTemplateToIndex } = usePflegeShiftTemplates();
  const [sorting, setSorting] = useState(false);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  if (ready && loadError) {
    return <LoadFailureView message={loadError} onRetry={() => void reload()} />;
  }
  if (!ready) return <LoadingView />;

  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <TabRootHeader
        accessory={
          <Pressable
            accessibilityLabel={sorting ? "Sortieren beenden" : "Schichten sortieren"}
            accessibilityRole="button"
            accessibilityState={{ selected: sorting }}
            onPress={() => {
              selectionFeedback();
              setSorting((current) => !current);
            }}
            testID="template-manager-sort-button"
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: RADII.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: sorting ? palette.sortAction : palette.surface,
              borderWidth: sorting ? 0 : 1,
              borderColor: palette.separator,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Ionicons
              accessibilityElementsHidden
              name="swap-vertical"
              size={23}
              color={sorting ? palette.onSortAction : palette.text}
            />
          </Pressable>
        }
        surface="groupedBackground"
        title="Schichten"
      />
      <ScreenScrollView
        scrollRef={reorderScroll.scrollRef}
        {...reorderScroll.scrollProps}
        contentContainerStyle={{ width: "100%", maxWidth: 560, alignSelf: "center" }}
        surface="groupedBackground"
        testID="templates-manager-scroll"
      >
        <FormStatus error={operationError} />
        <View style={{ gap: SPACING.md }}>
          {sorting ? (
            <ReorderableList
              testID="template-manager-sort"
              scroll={reorderScroll.controller}
              disabled={busyTemplateId !== null}
              items={templates.map((template) => ({
                id: template.id,
                title: template.name,
                subtitle: shiftTemplateSubtitle(template),
                leading: <ColorBadge color={template.color} label={template.symbol} size={38} />,
              }))}
              onMove={async (id, index) => {
                const template = templates.find((item) => item.id === id);
                if (!template) return;
                setBusyTemplateId(id);
                setOperationError(null);
                try {
                  await moveTemplateToIndex(template, index);
                } catch (error) {
                  setOperationError(
                    userFacingErrorMessage(error, "Vorlage konnte nicht verschoben werden."),
                  );
                  throw error;
                } finally {
                  setBusyTemplateId(null);
                }
              }}
            />
          ) : (
            <ShiftTemplateListCard testID="template-manager-list">
              {templates.length === 0 ? (
                <EmptyState
                  title="Keine Vorlagen"
                  message="Lege häufige Dienste einmal an und stemple sie danach direkt in den Kalender."
                />
              ) : (
                templates.map((template, index) => {
                  const subtitle = shiftTemplateSubtitle(template);
                  return (
                    <View key={template.id}>
                      {index > 0 ? <ShiftTemplateListSeparator /> : null}
                      <ShiftTemplateListRow
                        accessibilityLabel={`${template.name}, ${subtitle}, Vorlage bearbeiten`}
                        color={template.color}
                        disabled={busyTemplateId !== null}
                        moreAccessibilityLabel={`${template.name} bearbeiten`}
                        onMorePress={() => router.push(templateEditorRoute(template.id))}
                        onPress={() => router.push(templateEditorRoute(template.id))}
                        sorting={sorting}
                        subtitle={subtitle}
                        symbol={template.symbol}
                        testID={`template-manager-row-${template.id}`}
                        title={template.name}
                      />
                    </View>
                  );
                })
              )}
              {!sorting ? (
                <>
                  {templates.length > 0 ? <ShiftTemplateListSeparator /> : null}
                  <ShiftTemplateAddRow
                    accessibilityLabel="Neue Dienstvorlage erstellen"
                    onPress={() => router.push("/template-editor")}
                    testID="template-manager-add-row"
                  />
                </>
              ) : null}
            </ShiftTemplateListCard>
          )}
        </View>
      </ScreenScrollView>
    </View>
  );
}
