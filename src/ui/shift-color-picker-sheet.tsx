import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { useCallback } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SHIFT_COLOR_SWATCHES } from "@/theme/color-grid";
import { chipTextColor } from "@/theme/color-contrast";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { selectionFeedback } from "@/ui/haptics";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { BackFooterLayout } from "@/ui/back-footer-layout";

const COLUMN_COUNT = 10;

export function ShiftColorPickerSheet({
  visible,
  value,
  symbol,
  onChange,
  onClose,
}: {
  readonly visible: boolean;
  readonly value: string;
  readonly symbol: string;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - SPACING.lg * 2, 560);
  const cellWidth = (cardWidth - SPACING.md * 2 - 2) / COLUMN_COUNT;

  const selectColor = useCallback(
    (color: string) => {
      selectionFeedback();
      onChange(color);
    },
    [onChange],
  );

  const renderItem: ListRenderItem<string> = useCallback(
    ({ item }) => {
      const selected = item.toUpperCase() === value.toUpperCase();
      return (
        <Pressable
          accessibilityLabel={`Farbe ${item}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={() => selectColor(item)}
          style={({ pressed }) => [
            styles.swatchCell,
            { width: cellWidth, opacity: pressed ? 0.58 : 1 },
          ]}
        >
          <View
            style={[
              styles.swatchRing,
              {
                borderColor: selected ? palette.text : "transparent",
                backgroundColor: palette.surface,
              },
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: item }]} />
          </View>
        </Pressable>
      );
    },
    [cellWidth, palette.surface, palette.text, selectColor, value],
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <BackFooterLayout onPress={onClose} style={{ backgroundColor: palette.groupedBackground }}>
        {(bottomPadding) => (
          <View style={[styles.screen, { backgroundColor: palette.groupedBackground }]}>
            <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.md) }]}>
              <Pressable
                accessibilityLabel="Farbauswahl schließen"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  {
                    backgroundColor: palette.surfaceRaised,
                    opacity: pressed ? 0.62 : 1,
                  },
                ]}
              >
                <Ionicons color={palette.text} name="close" size={28} />
              </Pressable>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.title, { color: palette.text }]}
              >
                Farbe
              </Text>
              <View style={styles.headerPlaceholder} />
            </View>

            <View
              accessibilityLabel={`Vorschau mit Farbe ${value}`}
              accessible
              style={[styles.preview, { backgroundColor: value }]}
            >
              <ShiftSymbol color={chipTextColor} size={34} value={symbol} />
            </View>

            <View
              style={[
                styles.gridCard,
                {
                  width: cardWidth,
                  borderColor: palette.separator,
                  backgroundColor: palette.surface,
                },
              ]}
            >
              <FlatList
                contentContainerStyle={[styles.gridContent, { paddingBottom: bottomPadding }]}
                data={SHIFT_COLOR_SWATCHES}
                initialNumToRender={60}
                keyExtractor={(item) => item}
                numColumns={COLUMN_COUNT}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                windowSize={5}
              />
            </View>
          </View>
        )}
      </BackFooterLayout>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
  },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    fontFamily: INTER_FONTS.bold,
    fontSize: TYPOGRAPHY.editorTitle.fontSize,
    lineHeight: TYPOGRAPHY.highlightCount.lineHeight,
    fontWeight: "700",
  },
  headerPlaceholder: {
    width: 48,
    height: 48,
  },
  preview: {
    width: 76,
    height: 76,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 38,
    marginBottom: SPACING.xl,
  },
  gridCard: {
    minHeight: 0,
    flex: 1,
    alignSelf: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: RADII.large,
    borderCurve: CORNER_CURVE,
  },
  gridContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  swatchCell: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchRing: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 17,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});
