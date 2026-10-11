import { Text, TextInput } from "@/ui/text";
import { CORNER_CURVE, RADII, SHADOWS, SPACING } from "@/theme/tokens";
import { INTER_FONTS } from "@/theme/shadcn";
/* eslint-disable react-hooks/immutability -- Reanimated SharedValue.value is intentionally mutable on the UI thread. */
import type { ReactNode } from "react";
import type { KeyboardEvent } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { shouldDismissEntryEditOverlay } from "@/features/day-editor/entry-edit-overlay-pattern";
import {
  EntryEditHeader,
  EntryEditActionMenu,
  type EntryEditHeaderProps,
} from "@/features/day-editor/entry-edit-header";
import { MOTION } from "@/theme/motion";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SheetBackFooter } from "@/ui/sheet-back-footer";
import {
  ENTRY_EDIT_CLOSE_DURATION,
  ENTRY_EDIT_MOTION,
} from "@/features/day-editor/entry-edit-overlay-motion";

// Leave room below the focused field, with matching scrollable space at the end.
const FOCUSED_FIELD_CLEARANCE = 72;

export function EntryEditOverlayFrame({
  busy,
  cardContent,
  error,
  nativePresentation = Platform.OS === "ios",
  onBackdropPress,
  onClosingStart,
  onDismiss,
  onRequestClose,
  overlay,
  testIDPrefix,
  ...header
}: EntryEditHeaderProps & {
  readonly busy: boolean;
  readonly cardContent: ReactNode;
  readonly error: string | null;
  readonly nativePresentation?: boolean;
  readonly onBackdropPress?: () => void;
  readonly onClosingStart?: () => void;
  readonly onDismiss: () => void;
  readonly onRequestClose: () => Promise<boolean>;
  readonly overlay?: ReactNode;
  readonly testIDPrefix: string;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const closingRef = useRef(false);
  const fieldsRef = useRef<ScrollView>(null);
  const toolbarHeight = useRef(44);
  const revealFocusedField = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (input && keyboardVisible) {
      fieldsRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        input,
        toolbarHeight.current + FOCUSED_FIELD_CLEARANCE,
        true,
      );
    }
  }, [keyboardVisible]);
  useEffect(() => {
    // Recheck after native keyboard geometry has settled; onLayout can run earlier.
    const shown = Keyboard.addListener("keyboardDidShow", revealFocusedField);
    return () => shown.remove();
  }, [revealFocusedField]);
  useEffect(() => {
    const updateKeyboardVisibility = (visible: boolean, event: KeyboardEvent) => {
      // Change toolbar height in the same layout animation as the iOS keyboard.
      // Waiting for didHide leaves a second, unanimated jump after it has closed.
      if (Platform.OS === "ios" && !reduceMotion) Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(visible);
    };
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => updateKeyboardVisibility(true, event),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (event) => updateKeyboardVisibility(false, event),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reduceMotion]);
  const closedOffset = height + Math.max(insets.bottom, 24);
  const sheetTranslateY = useSharedValue(0);
  const backdropProgress = useSharedValue(1);
  const dragOriginY = useSharedValue(0);
  const exitAnimationFinishedRef = useRef(false);
  const saveSucceededRef = useRef<boolean | null>(null);
  const [gestureCloseRequest, setGestureCloseRequest] = useState(0);
  const handledGestureCloseRequest = useRef(0);

  const finishDismissIfReady = useCallback(() => {
    if (!exitAnimationFinishedRef.current || saveSucceededRef.current !== true) return;
    onDismiss();
  }, [onDismiss]);

  const markExitAnimationFinished = useCallback(() => {
    exitAnimationFinishedRef.current = true;
    finishDismissIfReady();
  }, [finishDismissIfReady]);

  const restoreOpenPosition = useCallback(() => {
    cancelAnimation(sheetTranslateY);
    cancelAnimation(backdropProgress);
    sheetTranslateY.value = withTiming(0, {
      duration: reduceMotion ? MOTION.duration.instant : ENTRY_EDIT_CLOSE_DURATION,
      easing: MOTION.easing.calm,
      reduceMotion: MOTION.reduceMotion,
    });
    backdropProgress.value = withTiming(1, {
      duration: reduceMotion ? MOTION.duration.instant : MOTION.duration.fast,
      easing: MOTION.easing.standard,
      reduceMotion: MOTION.reduceMotion,
    });
    setClosing(false);
    closingRef.current = false;
  }, [backdropProgress, reduceMotion, sheetTranslateY]);

  const handleSaveResult = useCallback(
    (saved: boolean) => {
      saveSucceededRef.current = saved;
      if (!saved) {
        restoreOpenPosition();
        return;
      }
      finishDismissIfReady();
    },
    [finishDismissIfReady, restoreOpenPosition],
  );

  const requestClose = useCallback(() => {
    if (busy || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setMenuVisible(false);
    onClosingStart?.();
    if (nativePresentation) {
      void onRequestClose().then(
        (saved) => {
          if (saved) onDismiss();
          else {
            closingRef.current = false;
            setClosing(false);
          }
        },
        () => {
          closingRef.current = false;
          setClosing(false);
        },
      );
      return;
    }
    exitAnimationFinishedRef.current = false;
    saveSucceededRef.current = null;
    cancelAnimation(sheetTranslateY);
    cancelAnimation(backdropProgress);
    sheetTranslateY.value = withTiming(
      closedOffset,
      {
        duration: reduceMotion ? MOTION.duration.instant : ENTRY_EDIT_CLOSE_DURATION,
        easing: MOTION.easing.calm,
        reduceMotion: MOTION.reduceMotion,
      },
      (finished) => {
        if (finished) runOnJS(markExitAnimationFinished)();
      },
    );
    backdropProgress.value = withTiming(0, {
      duration: reduceMotion ? MOTION.duration.instant : ENTRY_EDIT_CLOSE_DURATION,
      easing: MOTION.easing.calm,
      reduceMotion: MOTION.reduceMotion,
    });
    void onRequestClose().then(handleSaveResult, () => handleSaveResult(false));
  }, [
    backdropProgress,
    busy,
    closedOffset,
    nativePresentation,
    onDismiss,
    handleSaveResult,
    markExitAnimationFinished,
    onClosingStart,
    onRequestClose,
    reduceMotion,
    sheetTranslateY,
  ]);

  const queueGestureClose = useCallback(() => {
    setGestureCloseRequest((current) => current + 1);
  }, []);
  useEffect(() => {
    if (gestureCloseRequest === handledGestureCloseRequest.current) return;
    // Consume the gesture before saving: reopening after failure must not replay it.
    handledGestureCloseRequest.current = gestureCloseRequest;
    requestClose();
  }, [gestureCloseRequest, requestClose]);

  const dismissGesture = nativePresentation
    ? null
    : Gesture.Pan()
        .withTestId(`${testIDPrefix}-dismiss-gesture`)
        .enabled(!busy && !closing)
        .activeOffsetY([-6, 6])
        .failOffsetX([-28, 28])
        .onBegin(() => {
          cancelAnimation(sheetTranslateY);
          cancelAnimation(backdropProgress);
          dragOriginY.value = sheetTranslateY.value;
        })
        .onUpdate((event) => {
          const nextTranslateY = Math.max(0, dragOriginY.value + event.translationY);
          sheetTranslateY.value = nextTranslateY;
          backdropProgress.value = Math.max(
            0,
            1 - nextTranslateY / Math.max(closedOffset * 0.7, 1),
          );
        })
        .onEnd((event) => {
          if (shouldDismissEntryEditOverlay(event.translationY, event.velocityY)) {
            runOnJS(queueGestureClose)();
            return;
          }
          sheetTranslateY.value = withTiming(0, {
            duration: ENTRY_EDIT_CLOSE_DURATION,
            easing: MOTION.easing.calm,
            reduceMotion: MOTION.reduceMotion,
          });
          backdropProgress.value = withTiming(1, {
            duration: MOTION.duration.fast,
            easing: MOTION.easing.standard,
            reduceMotion: MOTION.reduceMotion,
          });
        })
        .onFinalize((_event, success) => {
          if (success) return;
          sheetTranslateY.value = withTiming(0, {
            duration: ENTRY_EDIT_CLOSE_DURATION,
            easing: MOTION.easing.calm,
            reduceMotion: MOTION.reduceMotion,
          });
          backdropProgress.value = withTiming(1, {
            duration: MOTION.duration.fast,
            easing: MOTION.easing.standard,
            reduceMotion: MOTION.reduceMotion,
          });
        });

  const backdropMotionStyle = useAnimatedStyle(() => ({ opacity: backdropProgress.value }));
  const sheetMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const editorHeader = (
    <Animated.View
      style={{ flexShrink: 0, zIndex: 4 }}
      onLayout={({ nativeEvent: { layout } }) => setHeaderHeight(layout.height)}
      testID={`${testIDPrefix}-drag-handle`}
    >
      {!nativePresentation ? (
        <View
          accessibilityElementsHidden
          style={[styles.grabber, { backgroundColor: palette.textMuted }]}
        />
      ) : null}
      <EntryEditHeader
        {...header}
        busy={busy || closing}
        menuVisible={menuVisible}
        onMenuPress={() => {
          onBackdropPress?.();
          setMenuVisible(!menuVisible);
        }}
      />
    </Animated.View>
  );

  return (
    <View style={styles.overlay} testID={`${testIDPrefix}-overlay`}>
      {!nativePresentation ? (
        <Animated.View
          entering={FadeIn.duration(MOTION.duration.normal).reduceMotion(MOTION.reduceMotion)}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: palette.overlay },
              backdropMotionStyle,
            ]}
            testID={`${testIDPrefix}-backdrop`}
          />
        </Animated.View>
      ) : null}
      {!nativePresentation ? (
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no"
          onPress={onBackdropPress}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.keyboardLayer}
        testID={`${testIDPrefix}-keyboard-layer`}
      >
        <View
          testID={`${testIDPrefix}-safe-viewport`}
          style={[
            nativePresentation ? styles.nativeViewport : styles.scrollContent,
            {
              paddingTop: nativePresentation ? SPACING.sm : Math.max(insets.top, 16),
            },
          ]}
        >
          <Animated.View
            entering={nativePresentation || reduceMotion ? undefined : ENTRY_EDIT_MOTION.sheet}
            style={[styles.shell, nativePresentation && styles.nativeShell]}
          >
            <Animated.View
              accessibilityViewIsModal
              pointerEvents={busy || closing ? "none" : "auto"}
              style={[
                styles.sheetContent,
                nativePresentation && styles.nativeShell,
                !nativePresentation && sheetMotionStyle,
              ]}
              testID={`${testIDPrefix}-sheet`}
            >
              <View
                style={[
                  styles.card,
                  nativePresentation && styles.nativeCard,
                  keyboardVisible && styles.keyboardDockedCard,
                  {
                    backgroundColor: palette.groupedBackground,
                    borderColor: palette.border,
                    shadowColor: palette.shadow,
                  },
                ]}
                testID={`${testIDPrefix}-card`}
              >
                {dismissGesture ? (
                  <GestureDetector gesture={dismissGesture}>{editorHeader}</GestureDetector>
                ) : (
                  editorHeader
                )}
                <ScrollView
                  ref={fieldsRef}
                  testID={`${testIDPrefix}-fields`}
                  style={[styles.fields, nativePresentation && styles.nativeFields]}
                  contentContainerStyle={keyboardVisible ? styles.typingContent : undefined}
                  automaticallyAdjustKeyboardInsets={false}
                  contentInsetAdjustmentBehavior="never"
                  keyboardDismissMode="interactive"
                  keyboardShouldPersistTaps="handled"
                  onFocus={revealFocusedField}
                  onLayout={revealFocusedField}
                >
                  {cardContent}
                </ScrollView>
                {keyboardVisible && !closing ? (
                  <View
                    testID={`${testIDPrefix}-keyboard-toolbar`}
                    onLayout={(event) => {
                      toolbarHeight.current = event.nativeEvent.layout.height;
                      revealFocusedField();
                    }}
                    style={[
                      styles.keyboardToolbar,
                      { backgroundColor: palette.surface, borderColor: palette.border },
                    ]}
                  >
                    <Pressable
                      accessibilityLabel="Fertig, Tastatur schließen"
                      accessibilityHint="Schließt nur die Tastatur. Der Eintrag bleibt geöffnet."
                      accessibilityRole="button"
                      onPress={() => Keyboard.dismiss()}
                      style={({ pressed }) => [
                        styles.keyboardDone,
                        { opacity: pressed ? 0.72 : 1 },
                      ]}
                    >
                      <Text
                        maxFontSizeMultiplier={TEXT_MAX_SCALE}
                        style={[styles.closeLabel, { color: palette.primary }]}
                      >
                        Fertig
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {error ? (
                  <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                    <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
                  </View>
                ) : null}

                {!keyboardVisible ? (
                  <View
                    style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}
                    testID={`${testIDPrefix}-close-arrival`}
                  >
                    <SheetBackFooter
                      accessibilityLabel="Schließen und speichern"
                      busy={busy || closing}
                      disabled={closing}
                      icon="close"
                      label="Schließen"
                      onPress={requestClose}
                    />
                  </View>
                ) : null}
                {menuVisible && header.onDelete && !busy && !closing ? (
                  <EntryEditActionMenu
                    top={headerHeight}
                    label={header.deleteLabel ?? "Eintrag löschen"}
                    onDelete={header.onDelete}
                    onClose={() => setMenuVisible(false)}
                  />
                ) : null}
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      {!busy && !closing ? overlay : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "transparent" },
  keyboardLayer: { flex: 1 },
  keyboardToolbar: {
    flexShrink: 0,
    alignItems: "flex-end",
    paddingHorizontal: SPACING.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  keyboardDone: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  scrollContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 0,
  },
  shell: { width: "100%", alignSelf: "center", flexShrink: 1 },
  sheetContent: { flexShrink: 1 },
  nativeViewport: { flex: 1 },
  nativeShell: { flex: 1 },
  // Override the fallback's explicit flexGrow: 0; flex: 1 alone cannot override it.
  nativeFields: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  nativeCard: { flex: 1, borderRadius: 0, borderWidth: 0, boxShadow: "none" },
  footer: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs, flexShrink: 0 },
  fields: { flexGrow: 0, flexShrink: 1 },
  typingContent: { paddingBottom: FOCUSED_FIELD_CLEARANCE },
  keyboardDockedCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  card: {
    flexShrink: 1,
    position: "relative",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    borderCurve: CORNER_CURVE,
    boxShadow: SHADOWS.overlay,
  },
  grabber: {
    alignSelf: "center",
    marginTop: SPACING.sm,
    width: 34,
    height: 4,
    borderRadius: 2,
    opacity: 0.62,
  },
  errorText: {
    paddingHorizontal: 8,
    fontFamily: INTER_FONTS.regular,
    fontSize: TYPOGRAPHY.small.fontSize,
    lineHeight: TYPOGRAPHY.small.lineHeight,
    textAlign: "center",
  },
  closeLabel: {
    fontFamily: INTER_FONTS.medium,
    fontSize: TYPOGRAPHY.sectionTitle.fontSize,
    fontWeight: "500",
  },
});
