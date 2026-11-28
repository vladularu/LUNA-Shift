import { Text, TextInput } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { router } from "expo-router";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, View } from "react-native";

import type { EntryLocation } from "@/domain/types";
import {
  consumeLocationPickerQuery,
  publishLocationSelection,
} from "@/features/location/location-selection";
import {
  type LocationSearchResult,
  useLocationSearch,
} from "@/features/location/use-location-search";
import { renderSoftScrollView, SoftScrollAnchor, SoftScrollScope } from "@/ui/soft-scroll-layout";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { TextEditorHeader } from "@/ui/text-editor-header";
import { TEXT_EDITOR_STYLES } from "@/ui/text-editor-styles";
import { SPACING } from "@/theme/tokens";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

type PickerRow =
  | { readonly id: "custom"; readonly kind: "CUSTOM"; readonly query: string }
  | {
      readonly id: string;
      readonly kind: "ADDRESS";
      readonly result: LocationSearchResult;
    };

export function LocationPickerScreen() {
  const palette = usePalette();
  const insets = useContext(SafeAreaInsetsContext);
  const input = useRef<TextInput>(null);
  const closed = useRef(false);
  const pendingSearch = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);
  const [initialQuery] = useState(() => consumeLocationPickerQuery().trim());
  const [query, setQuery] = useState(initialQuery);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const trimmedQuery = query.trim();
  const { error, loading, resolveResult, results } = useLocationSearch(query);
  const rows = useMemo<readonly PickerRow[]>(() => {
    if (!trimmedQuery) return [];
    return [
      { id: "custom", kind: "CUSTOM", query: trimmedQuery },
      ...results.map((result) => ({
        id: result.id,
        kind: "ADDRESS" as const,
        result,
      })),
    ];
  }, [results, trimmedQuery]);

  function close(location?: EntryLocation | null) {
    if (closed.current) return;
    closed.current = true;
    if (location !== undefined) publishLocationSelection(location);
    Keyboard.dismiss();
    router.back();
  }

  function submitCustomLocation() {
    if (pendingSearch.current) return;
    if (trimmedQuery === initialQuery) {
      close();
      return;
    }
    close(trimmedQuery ? { name: trimmedQuery } : null);
  }

  function chooseSearchResult(result: LocationSearchResult) {
    if (closed.current || pendingSearch.current) return;
    pendingSearch.current = true;
    setResolvingId(result.id);
    setSelectionError(null);
    void (async () => {
      try {
        const location = await resolveResult(result);
        close(location);
      } catch {
        if (closed.current) return;
        pendingSearch.current = false;
        setResolvingId(null);
        setSelectionError("Adresse nicht verfügbar. Übernimm nur den Ortsnamen.");
      }
    })();
  }

  function renderRow({ item }: { readonly item: PickerRow }) {
    if (item.kind === "CUSTOM") {
      return (
        <Pressable
          accessibilityHint="Übernimmt die Eingabe ohne Kartenposition"
          accessibilityLabel={`„${item.query}“ als Ort übernehmen`}
          accessibilityRole="button"
          disabled={resolvingId !== null}
          onPress={submitCustomLocation}
          style={({ pressed }) => [
            styles.resultRow,
            {
              backgroundColor: pressed ? palette.surfaceMuted : "transparent",
              opacity: resolvingId ? 0.5 : 1,
            },
          ]}
          testID="location-custom-result"
        >
          <Ionicons color={palette.textSecondary} name="location-outline" size={26} />
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={[styles.customResultText, { color: palette.text }]}
          >
            {`„${item.query}“ als Ort übernehmen`}
          </Text>
        </Pressable>
      );
    }

    const accessibilityLabel = [item.result.name, item.result.address].filter(Boolean).join(", ");
    return (
      <Pressable
        accessibilityHint="Übernimmt diese Adresse"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={resolvingId !== null}
        onPress={() => chooseSearchResult(item.result)}
        style={({ pressed }) => [
          styles.resultRow,
          {
            backgroundColor: pressed ? palette.surfaceMuted : "transparent",
            opacity: resolvingId && resolvingId !== item.id ? 0.5 : 1,
          },
        ]}
        testID="location-address-result"
      >
        {resolvingId === item.id ? (
          <ActivityIndicator color={palette.primary} size="small" />
        ) : (
          <Ionicons color={palette.danger} name="location" size={27} />
        )}
        <View style={styles.resultTextColumn}>
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={[styles.resultTitle, { color: palette.text }]}
          >
            {item.result.name}
          </Text>
          {item.result.address ? (
            <Text
              ellipsizeMode="tail"
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              numberOfLines={2}
              style={[styles.resultAddress, { color: palette.textMuted }]}
            >
              {item.result.address}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View
      style={[TEXT_EDITOR_STYLES.sheet, { backgroundColor: palette.surface }]}
      testID="location-picker"
    >
      <SoftScrollScope>
        <SoftScrollAnchor>
          <TextEditorHeader
            canConfirm={resolvingId === null && trimmedQuery !== initialQuery}
            onCancel={() => close()}
            onConfirm={submitCustomLocation}
            testID="location-picker-header"
            title="Ort"
          />
          <View
            style={[TEXT_EDITOR_STYLES.field, { backgroundColor: palette.surfaceMuted }]}
            testID="location-picker-input-row"
          >
            <TextInput
              accessibilityLabel="Ort oder Adresse"
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              editable={resolvingId === null}
              keyboardAppearance={palette.dark ? "dark" : "light"}
              ref={input}
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              onChangeText={(value) => {
                setSelectionError(null);
                setQuery(value);
              }}
              onSubmitEditing={submitCustomLocation}
              placeholder="Ort oder Adresse"
              placeholderTextColor={palette.textMuted}
              returnKeyType="done"
              submitBehavior="submit"
              selectionColor={palette.primary}
              style={[TEXT_EDITOR_STYLES.input, { color: palette.text }]}
              value={query}
            />
            {loading ? (
              <View accessibilityLabel="Adressen werden gesucht" accessibilityRole="progressbar">
                <ActivityIndicator color={palette.primary} size="small" />
              </View>
            ) : null}
            {query.length > 0 ? (
              <Pressable
                accessibilityLabel="Ortseingabe löschen"
                accessibilityRole="button"
                disabled={resolvingId !== null}
                onPress={() => {
                  setSelectionError(null);
                  setQuery("");
                  input.current?.focus();
                }}
                style={({ pressed }) => [TEXT_EDITOR_STYLES.clear, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Ionicons color={palette.textMuted} name="close-circle" size={22} />
              </Pressable>
            ) : null}
          </View>
        </SoftScrollAnchor>
        <FlatList
          renderScrollComponent={renderSoftScrollView}
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            styles.resultsContent,
            { paddingBottom: Math.max(insets?.bottom ?? 0, SPACING.md) },
          ]}
          data={rows}
          initialNumToRender={6}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: palette.separator }]} />
          )}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListFooterComponent={
            (selectionError ?? error) ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.error, { color: palette.textMuted }]}
              >
                {selectionError ?? error}
              </Text>
            ) : null
          }
          renderItem={renderRow}
          style={styles.results}
        />
      </SoftScrollScope>
    </View>
  );
}

const styles = StyleSheet.create({
  results: {
    flex: 1,
  },
  resultsContent: {
    flexGrow: 1,
  },
  resultRow: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  customResultText: {
    flex: 1,
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.sectionTitle.fontSize,
    lineHeight: TYPOGRAPHY.button.lineHeight,
    fontWeight: "400",
  },
  resultTextColumn: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  resultTitle: {
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.sectionTitle.fontSize,
    lineHeight: TYPOGRAPHY.button.lineHeight,
    fontWeight: "400",
  },
  resultAddress: {
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.small.fontSize,
    lineHeight: TYPOGRAPHY.label.lineHeight,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
  },
  error: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.label.fontSize,
    lineHeight: TYPOGRAPHY.label.lineHeight,
  },
});
