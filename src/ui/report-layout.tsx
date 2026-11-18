import { Text } from "@/ui/text";
import { useMemo, useRef, useState, type PropsWithChildren } from "react";
import { View, type ScrollView } from "react-native";
import { appResumeStore } from "@/navigation/app-resume-storage";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RADII, REPORT_CARD_GAP, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { ScreenScrollView } from "@/ui/screen-layout";
import { PeriodSwipeScroll } from "@/ui/period-swipe-scroll";
import {
  useReportScrollHeaderBinding,
  useReportScrollHeaderEnabled,
} from "@/ui/report-scroll-header";

type ReportScrollProps = PropsWithChildren<{
  readonly bottomPadding?: number;
  readonly resumeKey?: string | null;
}>;

export function ReportScrollView(props: ReportScrollProps) {
  const hasScrollEdge = useReportScrollHeaderEnabled();
  // The pager already keys each page by period. The resume key only changes
  // which page owns the saved scroll position.
  const key = hasScrollEdge ? "analysis-scroll" : (props.resumeKey ?? "default");
  return <ReportScrollContent key={key} {...props} />;
}

function ReportScrollContent({ children, bottomPadding, resumeKey }: ReportScrollProps) {
  const scrollRef = useRef<ScrollView>(null);
  const header = useReportScrollHeaderBinding(scrollRef);
  const [initialY] = useState(() => {
    const saved = appResumeStore.current();
    return saved && saved.href === resumeKey ? saved.scrollY : 0;
  });
  const restore = useRef({
    y: initialY,
    pending: !header.enabled || initialY > 0,
    height: 0,
    contentHeight: 0,
  });
  const restoreScroll = () => {
    const position = restore.current;
    if (!resumeKey || !position.pending || !position.height) return;
    const viewport = position.height - (header.enabled ? header.bottom : 0);
    const canRestore = position.contentHeight >= position.y + viewport;
    if (header.enabled && !canRestore) return;
    scrollRef.current?.scrollTo({ y: position.y, animated: false });
    if (canRestore) position.pending = false;
  };
  // Header measurements affect layout only. UIKit treats a changed
  // contentOffset prop as a command even on a mounted ScrollView.
  const contentStyle = useMemo(
    () =>
      header.enabled ? { paddingTop: SCREEN_LAYOUT.contentTopPadding + header.height } : undefined,
    [header.enabled, header.height],
  );
  const bottomInset = useMemo(
    () => (header.enabled ? { bottom: header.bottom } : undefined),
    [header.enabled, header.bottom],
  );
  const indicatorInsets = useMemo(
    () => (header.enabled ? { top: header.height, bottom: header.bottom } : undefined),
    [header.enabled, header.height, header.bottom],
  );
  const startOffset = useMemo(() => ({ x: 0, y: initialY }), [initialY]);

  if (header.enabled && header.height === 0) return null;
  return (
    <PeriodSwipeScroll>
      <ScreenScrollView
        surface="groupedBackground"
        bottomPadding={bottomPadding}
        scrollRef={scrollRef}
        contentOffset={header.enabled || resumeKey ? startOffset : undefined}
        contentContainerStyle={contentStyle}
        contentInsetAdjustmentBehavior={header.enabled ? "never" : undefined}
        automaticallyAdjustContentInsets={header.enabled ? false : undefined}
        contentInset={bottomInset}
        automaticallyAdjustsScrollIndicatorInsets={header.enabled ? false : undefined}
        scrollIndicatorInsets={indicatorInsets}
        onContentSizeChange={(_, height) => {
          restore.current.contentHeight = height;
          restoreScroll();
        }}
        onLayout={(event) => {
          header.bind();
          restore.current.height = event.nativeEvent.layout.height;
          restoreScroll();
        }}
        onScrollBeginDrag={() => {
          restore.current.pending = false;
        }}
        onScroll={
          resumeKey
            ? (event) => {
                if (!restore.current.pending) {
                  const y = event.nativeEvent.contentOffset.y;
                  appResumeStore.scroll(resumeKey, header.enabled ? Math.max(0, y) : y);
                }
              }
            : undefined
        }
        scrollEventThrottle={100}
        onScrollEndDrag={() => {
          if (resumeKey) void appResumeStore.flush();
        }}
        onMomentumScrollEnd={() => {
          if (resumeKey) void appResumeStore.flush();
        }}
      >
        {children}
      </ScreenScrollView>
    </PeriodSwipeScroll>
  );
}

export function ReportTestBadge() {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel="Testdaten"
      style={{
        alignSelf: "center",
        borderRadius: RADII.pill,
        backgroundColor: palette.primarySoft,
        paddingHorizontal: SPACING.sm,
        paddingVertical: 5,
      }}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.primary, ...TYPOGRAPHY.overline }}
      >
        TESTDATEN
      </Text>
    </View>
  );
}

export function ReportPeriodContent({ children }: PropsWithChildren) {
  return <View style={{ gap: REPORT_CARD_GAP }}>{children}</View>;
}
