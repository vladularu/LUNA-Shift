import { Text } from "@/ui/text";
import { useRef, useState, type PropsWithChildren } from "react";
import { View, type ScrollView } from "react-native";
import { appResumeStore } from "@/navigation/app-resume-storage";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RADII, REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { ScreenScrollView } from "@/ui/screen-layout";
import { PeriodSwipeScroll } from "@/ui/period-swipe-scroll";

type ReportScrollProps = PropsWithChildren<{
  readonly bottomPadding?: number;
  readonly resumeKey?: string | null;
}>;

export function ReportScrollView(props: ReportScrollProps) {
  return <ReportScrollContent key={props.resumeKey ?? "default"} {...props} />;
}

function ReportScrollContent({ children, bottomPadding, resumeKey }: ReportScrollProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [initialY] = useState(() => {
    const saved = appResumeStore.current();
    return saved && saved.href === resumeKey ? saved.scrollY : 0;
  });
  const restore = useRef({
    y: initialY,
    pending: true,
    height: 0,
    contentHeight: 0,
  });
  const restoreScroll = () => {
    const position = restore.current;
    if (!resumeKey || !position.pending || !position.height) return;
    scrollRef.current?.scrollTo({ y: position.y, animated: false });
    if (position.contentHeight >= position.y + position.height) position.pending = false;
  };
  return (
    <PeriodSwipeScroll>
      <ScreenScrollView
        surface="groupedBackground"
        bottomPadding={bottomPadding}
        scrollRef={scrollRef}
        contentOffset={resumeKey ? { x: 0, y: initialY } : undefined}
        onContentSizeChange={(_, height) => {
          restore.current.contentHeight = height;
          restoreScroll();
        }}
        onLayout={(event) => {
          restore.current.height = event.nativeEvent.layout.height;
          restoreScroll();
        }}
        onScrollBeginDrag={() => {
          restore.current.pending = false;
        }}
        onScroll={
          resumeKey
            ? (event) => {
                if (!restore.current.pending)
                  appResumeStore.scroll(resumeKey, event.nativeEvent.contentOffset.y);
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
