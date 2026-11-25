import { Text, TextInput } from "@/ui/text";
import { CORNER_CURVE, RADII, SHADOWS, SPACING } from "@/theme/tokens";
import { INTER_FONTS } from "@/theme/shadcn";
import { useLocalSearchParams } from "expo-router";
/* eslint-disable react-hooks/immutability -- Reanimated SharedValue.value is intentionally mutable on the UI thread. */
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type KeyboardEvent,
  type ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
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
  type EntryEditHeaderProps,
} from "@/features/day-editor/entry-edit-header";
import { usesEntryOverviewSheet } from "@/features/day-editor/entry-edit-presentation";
import { MOTION } from "@/theme/motion";
import { SoftScrollAnchor, SoftScrollScope, SoftScrollView } from "@/ui/soft-scroll-layout";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { FloatingGlassBackground } from "@/ui/floating-glass-background";
import { SecondaryButton } from "@/ui/form-controls";
import { useGlassAppearance } from "@/ui/glass-appearance";
import { SheetBackFooter } from "@/ui/sheet-back-footer";
import {
  ENTRY_EDIT_CLOSE_DURATION,
  useEntryEditCloseFooterMotion,
} from "@/features/day-editor/entry-edit-overlay-motion";

// Leave room below the focused field, with matching scrollable space at the end.
const FOCUSED_FIELD_CLEARANCE = 72;
const OVERVIEW_RADIUS = RADII.sheet + SPACING.sm;
const OVERVIEW_HEIGHT_FRACTION = 0.54;
const APPOINTMENT_FORM_HEIGHT_FRACTION = 0.68;
const OVERVIEW_SIDE_INSET = SPACING.lg;
const STAGED_SHEET_EXIT_EASING = Easing.in(Easing.quad);

interface EntryOverviewStage {
  readonly expanded: boolean;
  readonly compactHeightFraction: number;
  readonly editLabel?: string;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
}

export function useEntryOverviewStage(
  mode: "SHIFT" | "APPOINTMENT",
  existing: boolean,
  closePickers: () => void,
): EntryOverviewStage | undefined {
  const params = useLocalSearchParams();
  const [expanded, setExpanded] = useState(false);
  if (
    Platform.OS !== "ios" ||
    (!existing && mode === "SHIFT") ||
    !usesEntryOverviewSheet(params, mode)
  ) {
    return undefined;
  }
  return {
    expanded,
    compactHeightFraction: existing ? OVERVIEW_HEIGHT_FRACTION : APPOINTMENT_FORM_HEIGHT_FRACTION,
    editLabel: existing
      ? mode === "SHIFT"
        ? "Dienst bearbeiten"
        : "Termin bearbeiten"
      : undefined,
    onExpand: () => setExpanded(true),
    onCollapse: () => {
      closePickers();
      setExpanded(false);
    },
  };
}

export function EntryEditOverlayFrame({
  busy,
  cardContent,
  contentKey,
  closeLabel = "Schließen",
  error,
  fieldsContentContainerStyle,
  nativePresentation = Platform.OS === "ios",
  onBackdropPress,
  onClosingStart,
  onDismiss,
  onRequestClose,
  overlay,
  overviewStage,
  readOnly = false,
  testIDPrefix,
  ...header
}: EntryEditHeaderProps & {
  readonly busy: boolean;
  readonly cardContent: ReactNode;
  readonly contentKey?: string;
  readonly closeLabel?: string;
  readonly error: string | null;
  readonly fieldsContentContainerStyle?: ScrollViewProps["contentContainerStyle"];
  readonly nativePresentation?: boolean;
  readonly onBackdropPress?: () => void;
  readonly onClosingStart?: () => void;
  readonly onDismiss: () => void;
  readonly onRequestClose: () => Promise<boolean>;
  readonly overlay?: ReactNode;
  readonly overviewStage?: EntryOverviewStage;
  readonly readOnly?: boolean;
  readonly testIDPrefix: string;
}) {
  const palette = usePalette();
  const { nativeGlass } = useGlassAppearance();
  const canResize = overviewStage !== undefined;
  const stagedSheet = canResize || readOnly;
  const compactSheet = readOnly || overviewStage?.expanded === false;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const viewportTop = Math.max(insets.top, 16);
  const expandedHeight = Math.max(0, height - viewportTop);
  const compactHeight = Math.min(
    height * (overviewStage?.compactHeightFraction ?? OVERVIEW_HEIGHT_FRACTION),
    expandedHeight,
  );
  const targetHeight = compactSheet ? compactHeight : expandedHeight;
  const reduceMotion = useReducedMotion();
  const animateCloseFooter = stagedSheet && !nativePresentation && !reduceMotion;
  const { footerMotionStyle, onFooterLayout, sheetEntering } = useEntryEditCloseFooterMotion(
    animateCloseFooter,
    height,
  );
  const [closing, setClosing] = useState(false);
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
  const overviewHeight = useSharedValue(targetHeight);
  const dragOriginHeight = useSharedValue(targetHeight);
  useEffect(() => {
    if (!stagedSheet) return;
    overviewHeight.value = withTiming(targetHeight, {
      duration: reduceMotion ? MOTION.duration.instant : ENTRY_EDIT_CLOSE_DURATION,
      easing: MOTION.easing.calm,
      reduceMotion: MOTION.reduceMotion,
    });
  }, [overviewHeight, reduceMotion, stagedSheet, targetHeight]);
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
    const useStagedExit = animateCloseFooter && !keyboardVisible;
    // The card and footer share this translation. Use the current height while changing detents.
    const exitOffset = useStagedExit
      ? Math.max(Math.max(targetHeight, overviewHeight.get()) + SPACING.sm, sheetTranslateY.get())
      : closedOffset;
    const options = {
      duration: reduceMotion
        ? MOTION.duration.instant
        : useStagedExit
          ? MOTION.duration.normal
          : ENTRY_EDIT_CLOSE_DURATION,
      easing: useStagedExit ? STAGED_SHEET_EXIT_EASING : MOTION.easing.calm,
      reduceMotion: MOTION.reduceMotion,
    };
    sheetTranslateY.set(
      withTiming(exitOffset, options, (finished) => {
        if (finished) runOnJS(markExitAnimationFinished)();
      }),
    );
    backdropProgress.set(withTiming(0, options));
    void onRequestClose().then(handleSaveResult, () => handleSaveResult(false));
  }, [
    animateCloseFooter,
    backdropProgress,
    busy,
    closedOffset,
    handleSaveResult,
    keyboardVisible,
    markExitAnimationFinished,
    nativePresentation,
    onClosingStart,
    onDismiss,
    onRequestClose,
    overviewHeight,
    reduceMotion,
    sheetTranslateY,
    targetHeight,
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

  const expandOverview = overviewStage?.onExpand;
  const collapseOverview = overviewStage?.onCollapse;
  const collapseFromGesture = () => {
    Keyboard.dismiss();
    collapseOverview?.();
  };
  const settleDrag = () => {
    "worklet";
    const options = {
      duration: ENTRY_EDIT_CLOSE_DURATION,
      easing: MOTION.easing.calm,
      reduceMotion: MOTION.reduceMotion,
    };
    sheetTranslateY.value = withTiming(0, options);
    if (stagedSheet) overviewHeight.value = withTiming(targetHeight, options);
    backdropProgress.value = withTiming(1, {
      duration: MOTION.duration.fast,
      easing: MOTION.easing.standard,
      reduceMotion: MOTION.reduceMotion,
    });
  };
  const dismissGesture = nativePresentation
    ? null
    : Gesture.Pan()
        .withTestId(`${testIDPrefix}-dismiss-gesture`)
        .enabled(!busy && !closing)
        .activeOffsetY([-6, 6])
        .failOffsetX([-28, 28])
        .onStart(() => {
          cancelAnimation(sheetTranslateY);
          cancelAnimation(backdropProgress);
          dragOriginY.value = sheetTranslateY.value;
          if (canResize) {
            cancelAnimation(overviewHeight);
            dragOriginHeight.value = overviewHeight.value;
          }
        })
        .onUpdate((event) => {
          if (canResize) {
            overviewHeight.value = Math.min(
              expandedHeight,
              Math.max(compactHeight, dragOriginHeight.value - event.translationY),
            );
            if (!compactSheet) return;
          }
          const nextTranslateY = Math.max(0, dragOriginY.value + event.translationY);
          sheetTranslateY.value = nextTranslateY;
          backdropProgress.value = Math.max(
            0,
            1 - nextTranslateY / Math.max(closedOffset * 0.7, 1),
          );
        })
        .onEnd((event) => {
          if (
            compactSheet &&
            expandOverview &&
            shouldDismissEntryEditOverlay(-event.translationY, -event.velocityY)
          ) {
            runOnJS(expandOverview)();
            return;
          }
          if (shouldDismissEntryEditOverlay(event.translationY, event.velocityY)) {
            if (stagedSheet && !compactSheet) runOnJS(collapseFromGesture)();
            else runOnJS(queueGestureClose)();
            return;
          }
          settleDrag();
        })
        .onFinalize((_event, success) => {
          if (!success) settleDrag();
        });

  const backdropOpacity = stagedSheet && !palette.dark ? 0.9 : 1;
  const backdropMotionStyle = useAnimatedStyle(() => ({
    opacity: backdropProgress.value * backdropOpacity,
  }));
  const overviewHeightStyle = useAnimatedStyle(() => ({ height: overviewHeight.value }));
  const sheetMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const editorHeader = (
    <Animated.View style={{ flexShrink: 0, zIndex: 4 }} testID={`${testIDPrefix}-drag-handle`}>
      {!nativePresentation ? (
        <View
          accessibilityElementsHidden
          style={[styles.grabber, { backgroundColor: palette.textMuted }]}
        />
      ) : null}
      <EntryEditHeader
        {...header}
        busy={busy || closing}
        onDelete={
          header.onDelete &&
          (() => {
            onBackdropPress?.();
            header.onDelete?.();
          })
        }
      />
    </Animated.View>
  );
  const closeFooter = keyboardVisible ? null : (
    <Animated.View
      onLayout={animateCloseFooter ? onFooterLayout : undefined}
      style={[
        styles.footer,
        compactSheet && styles.detachedFooter,
        { paddingBottom: Math.max(insets.bottom, SPACING.md) },
        animateCloseFooter && footerMotionStyle,
      ]}
      testID={`${testIDPrefix}-close-arrival`}
    >
      <SheetBackFooter
        accessibilityLabel={
          readOnly || closeLabel === "Speichern" ? closeLabel : "Schließen und speichern"
        }
        busy={busy || closing}
        disabled={closing}
        icon={closeLabel === "Speichern" ? "checkmark" : "close"}
        label={closeLabel}
        onPress={requestClose}
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
              paddingTop: nativePresentation ? SPACING.sm : viewportTop,
            },
          ]}
        >
          <Animated.View
            entering={nativePresentation || reduceMotion ? undefined : sheetEntering}
            style={[
              styles.shell,
              nativePresentation && styles.nativeShell,
              stagedSheet && [styles.stagedShell, overviewHeightStyle],
            ]}
          >
            <Animated.View
              accessibilityViewIsModal
              pointerEvents={busy || closing ? "none" : "auto"}
              style={[
                styles.sheetContent,
                (nativePresentation || stagedSheet) && styles.nativeShell,
                !nativePresentation && sheetMotionStyle,
              ]}
              testID={`${testIDPrefix}-sheet`}
            >
              <View
                style={[
                  styles.card,
                  nativePresentation && styles.nativeCard,
                  stagedSheet && styles.stagedCard,
                  compactSheet && styles.overviewCard,
                  keyboardVisible && styles.keyboardDockedCard,
                  {
                    backgroundColor:
                      compactSheet && nativeGlass ? "transparent" : palette.groupedBackground,
                    borderColor: palette.border,
                    shadowColor: palette.shadow,
                  },
                ]}
                testID={`${testIDPrefix}-card`}
              >
                {compactSheet && nativeGlass ? (
                  <FloatingGlassBackground dark={palette.dark} radius={OVERVIEW_RADIUS} />
                ) : null}
                <SoftScrollScope>
                  <SoftScrollAnchor>
                    {dismissGesture ? (
                      <GestureDetector gesture={dismissGesture}>{editorHeader}</GestureDetector>
                    ) : (
                      editorHeader
                    )}
                  </SoftScrollAnchor>
                  <SoftScrollView
                    key={contentKey}
                    ref={fieldsRef}
                    testID={`${testIDPrefix}-fields`}
                    style={[
                      styles.fields,
                      (nativePresentation || stagedSheet) && styles.fillFields,
                    ]}
                    contentContainerStyle={
                      keyboardVisible ? styles.typingContent : fieldsContentContainerStyle
                    }
                    automaticallyAdjustKeyboardInsets={false}
                    contentInsetAdjustmentBehavior="never"
                    keyboardDismissMode="interactive"
                    keyboardShouldPersistTaps="handled"
                    onFocus={revealFocusedField}
                    onLayout={revealFocusedField}
                  >
                    {cardContent}
                  </SoftScrollView>
                </SoftScrollScope>
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

                {compactSheet && overviewStage?.editLabel ? (
                  <View style={[styles.footer, styles.overviewAction]}>
                    <SecondaryButton
                      disabled={busy || closing}
                      shape="pill"
                      onPress={overviewStage.onExpand}
                    >
                      {overviewStage.editLabel}
                    </SecondaryButton>
                  </View>
                ) : (
                  !compactSheet && closeFooter
                )}
              </View>
              {compactSheet ? closeFooter : null}
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
  stagedShell: { maxHeight: "100%" },
  sheetContent: { flexShrink: 1 },
  nativeViewport: { flex: 1 },
  nativeShell: { flex: 1 },
  // Override the fallback's explicit flexGrow: 0; flex: 1 alone cannot override it.
  fillFields: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  nativeCard: { flex: 1, borderRadius: 0, borderWidth: 0, boxShadow: "none" },
  stagedCard: { flex: 1, borderWidth: 0 },
  footer: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs, flexShrink: 0 },
  overviewCard: {
    marginHorizontal: OVERVIEW_SIDE_INSET,
    borderRadius: OVERVIEW_RADIUS,
  },
  overviewAction: { paddingBottom: SPACING.md },
  detachedFooter: { paddingTop: SPACING.sm, paddingHorizontal: OVERVIEW_SIDE_INSET },
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
