import { Switch } from "@/ui/switch";
import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { useEffect, useState, type ComponentProps } from "react";
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { ANALYSIS_CARD_TITLES, type AnalysisCardId } from "@/domain/analysis-view";
import { moveListItem } from "@/domain/reorder";
import { ReorderableList } from "@/ui/reorderable-list";
import { useReorderScroll } from "@/ui/use-reorder-scroll";
import { usePalette } from "@/theme/palette";
import { SPACING, RADII } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { BackFooterLayout } from "@/ui/back-footer-layout";
import { selectionFeedback } from "@/ui/haptics";
import { useAnalysisView } from "./analysis-view-preferences";

const CARD_ICONS: Record<AnalysisCardId, ComponentProps<typeof Ionicons>["name"]> = {
  WORK: "time-outline",
  CHECK: "shield-checkmark-outline",
  PAY: "wallet-outline",
  SHIFTS: "calendar-outline",
};

export function AnalysisViewControls({ compact = false }: { readonly compact?: boolean }) {
  const p = usePalette();
  const state = useAnalysisView();
  const [open, setOpen] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [savingVisible, setSavingVisible] = useState(false);
  const reduced = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3;
  const reorderScroll = useReorderScroll();
  useEffect(() => {
    if (!open || !state.saving) {
      setSavingVisible(false);
      return;
    }
    const timer = setTimeout(() => setSavingVisible(true), 600);
    return () => clearTimeout(timer);
  }, [open, state.saving]);
  const showSaving = open && state.saving && savingVisible;
  const error = state.error ? (
    <View accessibilityRole="alert" style={{ gap: SPACING.sm }}>
      <Text style={{ color: p.text, ...TYPOGRAPHY.body }}>{state.error}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={state.retry}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: p.primary, ...TYPOGRAPHY.bodyStrong }}>Erneut versuchen</Text>
      </Pressable>
    </View>
  ) : null;
  return (
    <View style={{ gap: SPACING.sm }}>
      {compact ? null : error}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ansicht anpassen"
        disabled={!state.ready}
        accessibilityState={{ disabled: !state.ready, busy: !state.ready }}
        onPress={() => {
          selectionFeedback();
          setSorting(false);
          setOpen(true);
        }}
        style={({ pressed }) => ({
          minHeight: 44,
          minWidth: 44,
          width: compact ? 44 : undefined,
          borderRadius: compact ? RADII.pill : undefined,
          borderWidth: compact ? 1 : 0,
          borderColor: p.separator,
          backgroundColor: compact ? p.surface : undefined,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: SPACING.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="options-outline" color={p.textMuted} size={19} />
        {compact ? null : (
          <Text style={{ color: p.textMuted, ...TYPOGRAPHY.body }}>Ansicht anpassen</Text>
        )}
      </Pressable>
      <Modal
        visible={open}
        presentationStyle="fullScreen"
        animationType={reduced ? "none" : "slide"}
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaProvider>
          <BackFooterLayout
            onPress={() => setOpen(false)}
            style={{ backgroundColor: p.groupedBackground }}
          >
            {(bottomPadding) => (
              <SafeAreaView
                edges={["top", "left", "right"]}
                style={{ flex: 1, backgroundColor: p.groupedBackground }}
              >
                <View
                  style={{
                    padding: SPACING.lg,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                  }}
                >
                  <Text
                    accessibilityRole="header"
                    style={{ flex: 1, color: p.text, ...TYPOGRAPHY.screenTitle }}
                  >
                    Ansicht anpassen
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={sorting ? "Auswahl anzeigen" : "Reihenfolge ändern"}
                    accessibilityState={{ selected: sorting }}
                    onPress={() => {
                      selectionFeedback();
                      setSorting((value) => !value);
                    }}
                    testID="analysis-sort-button"
                    style={({ pressed }) => ({
                      width: 48,
                      height: 48,
                      borderRadius: RADII.pill,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: sorting ? p.sortAction : p.surface,
                      borderWidth: sorting ? 0 : 1,
                      borderColor: p.separator,
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      name="swap-vertical"
                      size={23}
                      color={sorting ? p.onSortAction : p.text}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Ansicht schließen"
                    onPress={() => setOpen(false)}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      minWidth: 44,
                      borderRadius: RADII.pill,
                      backgroundColor: p.surfaceMuted,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Ionicons name="close" size={22} color={p.text} />
                  </Pressable>
                </View>
                <ScrollView
                  ref={reorderScroll.scrollRef}
                  {...reorderScroll.scrollProps}
                  contentContainerStyle={{
                    padding: SPACING.lg,
                    paddingBottom: bottomPadding,
                    gap: SPACING.md,
                  }}
                >
                  {sorting ? (
                    <ReorderableList
                      testID="analysis-sort"
                      scroll={reorderScroll.controller}
                      disabled={state.saving}
                      saveFailed={state.error !== null}
                      items={state.preferences.order.map((id) => ({
                        id,
                        title: ANALYSIS_CARD_TITLES[id],
                        subtitle: state.preferences.hidden.includes(id)
                          ? "Ausgeblendet"
                          : undefined,
                        leading: <Ionicons name={CARD_ICONS[id]} size={24} color={p.textMuted} />,
                      }))}
                      onMove={(id, to) =>
                        state.update((current) => ({
                          ...current,
                          order: moveListItem(
                            current.order,
                            current.order.indexOf(id as AnalysisCardId),
                            to,
                          ),
                        }))
                      }
                    />
                  ) : (
                    <SurfaceCard>
                      {state.preferences.order.map((id, index) => {
                        const visible = !state.preferences.hidden.includes(id);
                        return (
                          <View
                            key={id}
                            testID={`analysis-setting-${id}`}
                            style={{
                              minHeight: 72,
                              borderTopWidth: index > 0 ? 1 : 0,
                              borderTopColor: p.separator,
                              paddingHorizontal: SPACING.lg,
                              paddingVertical: SPACING.sm,
                              gap: SPACING.md,
                              flexDirection: stacked ? "column" : "row",
                              alignItems: stacked ? "stretch" : "center",
                            }}
                          >
                            <View
                              style={{
                                flex: stacked ? undefined : 1,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: SPACING.md,
                              }}
                            >
                              <Ionicons name={CARD_ICONS[id]} size={22} color={p.textMuted} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: p.text, ...TYPOGRAPHY.body }}>
                                  {ANALYSIS_CARD_TITLES[id]}
                                </Text>
                                {sorting && !visible ? (
                                  <Text style={{ color: p.textMuted, ...TYPOGRAPHY.caption }}>
                                    Ausgeblendet
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                            <View
                              style={{
                                minHeight: 44,
                                justifyContent: "center",
                                alignSelf: stacked ? "flex-end" : undefined,
                              }}
                            >
                              <Switch
                                accessibilityLabel={ANALYSIS_CARD_TITLES[id] + " anzeigen"}
                                hitSlop={8}
                                value={visible}
                                trackColor={{ true: p.accent, false: p.surfaceMuted }}
                                onValueChange={(enabled) => {
                                  selectionFeedback();
                                  state.update((current) => ({
                                    ...current,
                                    hidden: enabled
                                      ? current.hidden.filter((key) => key !== id)
                                      : [...current.hidden, id],
                                  }));
                                }}
                              />
                            </View>
                          </View>
                        );
                      })}
                    </SurfaceCard>
                  )}
                  {error}
                  <Text
                    accessibilityElementsHidden={!showSaving}
                    importantForAccessibility={showSaving ? "auto" : "no-hide-descendants"}
                    accessibilityLiveRegion="polite"
                    style={{
                      color: p.textMuted,
                      ...TYPOGRAPHY.caption,
                      opacity: showSaving ? 1 : 0,
                    }}
                  >
                    Wird gespeichert …
                  </Text>
                </ScrollView>
              </SafeAreaView>
            )}
          </BackFooterLayout>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
