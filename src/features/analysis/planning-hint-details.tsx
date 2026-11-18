import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { PlanningNightSequence } from "@/domain/planning-night-policy";
import type { PlanningWeekendWindow } from "@/domain/planning-weekend-policy";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import type { PlanningHintPresentation } from "./planning-hint-presentation";
import { restDuration, type RestTimeline, type WorkSeries } from "./compliance-timeline";
import { WeekendAssessmentWindows, weekendHintTitle } from "./weekend-assessment-summary";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import {
  CheckDetailCard,
  checkSourceLinkStyle,
  CheckDetailStack,
  CheckDetailHeading,
  type planningHintIcon,
  useCheckReferenceDetail,
} from "./check-detail-layout";
import { checkPeriodLabel } from "./check-period-label";

const dateLabel = (value: string) => value.split("-").reverse().join(".");

export function PlanningHintDetails({
  hint,
  icon,
  rest,
  series,
  missing,
  originalDescription,
  nightSequence,
  weekend,
  children,
}: {
  readonly hint: PlanningHintPresentation;
  readonly icon?: ReturnType<typeof planningHintIcon>;
  readonly rest: RestTimeline | null;
  readonly series: WorkSeries | null;
  readonly missing: boolean;
  readonly originalDescription?: string;
  readonly nightSequence?: PlanningNightSequence | null;
  readonly weekend?: PlanningWeekendWindow;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  const reference = useCheckReferenceDetail();
  const body = reference
    ? { ...CHECK_REFERENCE_TYPOGRAPHY.body, color: reference.secondary }
    : { color: palette.textMuted, ...TYPOGRAPHY.body };
  const nightSeries =
    nightSequence && series
      ? nightSequence.countIsMinimum
        ? `Mindestens ${series.count} aufeinanderfolgende Nachtdienste sind erfasst.`
        : `Du hast ${series.count} Nachtdienste direkt hintereinander eingetragen.`
      : null;
  let explanation = hint.compactTitle
    ? hint.explanation
    : "Für diesen Hinweis sind die Angaben nicht eindeutig auswertbar.";
  if (weekend) {
    explanation =
      weekend.freeCount === 1
        ? "In diesem Zeitraum ist 1 Wochenende frei."
        : "In diesem Zeitraum ist kein Wochenende frei.";
  } else if (nightSeries) {
    explanation = nightSeries;
  }
  const recoveryNote = nightSeries && !rest ? hint.explanation : hint.recoveryNote;
  const additional = hint.compactTitle
    ? []
    : [
        ...new Set(
          [hint.explanation, originalDescription].filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0 && value !== explanation,
          ),
        ),
      ];
  const range =
    weekend ??
    (rest
      ? { from: nightSequence?.firstNight ?? rest.endDate, until: rest.startDate }
      : series?.from && series.until
        ? { from: series.from, until: series.until }
        : hint.weekendPeriod);
  const title = weekend
    ? weekendHintTitle(weekend.freeCount)
    : reference
      ? (hint.compactTitle ?? hint.title)
      : hint.title;
  return (
    <CheckDetailStack testID="planning-hint-detail-content">
      <CheckDetailHeading
        kind="planning"
        planningIcon={icon}
        period={range ? checkPeriodLabel(range.from, range.until) : "Dienstplanung"}
        title={title}
        caption="Empfehlung · keine gesetzliche Mindestgrenze"
      />
      {children ? <CheckDetailCard>{children}</CheckDetailCard> : null}
      <CheckDetailCard title={reference && rest ? "Was wäre günstiger?" : "Einordnung"}>
        <Text style={body}>{explanation}</Text>
        {hint.recommendation ? <Text style={body}>{hint.recommendation}</Text> : null}
        {(!reference || !rest) &&
        (rest ||
          series?.dutyPeriod ||
          (series?.from && series.until) ||
          (hint.weekendPeriod && !hint.weekendAssessment)) ? (
          <View style={{ gap: SPACING.sm }}>
            {!reference && rest ? (
              <View style={{ gap: SPACING.xs }}>
                <Text style={body}>
                  {dateLabel(rest.endDate)} · {rest.previous.endTime} bis{" "}
                  {dateLabel(rest.startDate)} · {rest.next.startTime}
                </Text>
                {!hint.scientificNight || !hint.compactTitle ? (
                  <Text
                    accessibilityLabel={restDuration(rest.minutes) + " arbeitsfreie Zeit"}
                    style={body}
                  >
                    {restDuration(rest.minutes)}
                  </Text>
                ) : null}
              </View>
            ) : series?.dutyPeriod ? (
              <Text style={body}>
                {dateLabel(series.dutyPeriod.fromDate)} · {series.dutyPeriod.fromTime} bis{" "}
                {dateLabel(series.dutyPeriod.untilDate)} · {series.dutyPeriod.untilTime}
              </Text>
            ) : series?.from && series.until ? (
              <Text style={body}>
                {dateLabel(series.from)} bis {dateLabel(series.until)}
              </Text>
            ) : hint.weekendPeriod && !hint.weekendAssessment ? (
              <Text style={body}>
                {dateLabel(hint.weekendPeriod.from)} bis {dateLabel(hint.weekendPeriod.until)}
              </Text>
            ) : null}
          </View>
        ) : null}
        {recoveryNote ? <Text style={body}>{recoveryNote}</Text> : null}
      </CheckDetailCard>
      {additional.length ? (
        <CheckDetailCard disclosure>
          <CheckDetailDisclosure title="Weitere Angaben" testID="planning-original-details">
            {additional.map((text) => (
              <Text key={text} style={body}>
                {text}
              </Text>
            ))}
          </CheckDetailDisclosure>
        </CheckDetailCard>
      ) : null}

      {!reference && hint.weekendAssessment ? (
        <CheckDetailCard>
          <WeekendAssessmentWindows assessment={hint.weekendAssessment} affectedOnly />
        </CheckDetailCard>
      ) : null}
      {missing ? (
        <CheckDetailCard>
          <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
        </CheckDetailCard>
      ) : null}
      {hint.sources.length || hint.policyNote ? (
        <CheckDetailCard disclosure>
          <CheckDetailDisclosure
            title={reference ? "Prüfgrundlage" : "Quelle und Prüfgrenzen"}
            testID="planning-source-disclosure"
          >
            <Text style={body}>
              {hint.policyNote ??
                "Dieser Hinweis hilft bei der Dienstplanung. Gesetzliche und tarifliche Regeln werden zusätzlich geprüft."}
            </Text>
            {hint.sources.map((source) => (
              <Pressable
                key={source.url}
                accessibilityRole="link"
                accessibilityLabel={source.title}
                onPress={() => {
                  void Linking.openURL(source.url).catch(() => {
                    Alert.alert(
                      "Link nicht geöffnet",
                      "Du kannst die Quelle später erneut öffnen.",
                    );
                  });
                }}
                style={{
                  minHeight: MINIMUM_TOUCH_TARGET,
                  justifyContent: "center",
                  gap: SPACING.xs,
                }}
              >
                <Text style={[TYPOGRAPHY.body, checkSourceLinkStyle(palette)]}>{source.title}</Text>
                <Text style={body}>{source.context}</Text>
              </Pressable>
            ))}
          </CheckDetailDisclosure>
        </CheckDetailCard>
      ) : null}
    </CheckDetailStack>
  );
}
