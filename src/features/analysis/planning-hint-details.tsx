import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import type { PlanningHintPresentation } from "./planning-hint-presentation";
import { restDuration, type RestTimeline, type WorkSeries } from "./compliance-timeline";
import { WeekendAssessmentWindows } from "./weekend-assessment-summary";
import { CheckDetailDisclosure } from "./check-detail-disclosure";

const dateLabel = (value: string) => value.split("-").reverse().join(".");

export function PlanningHintDetails({
  hint,
  rest,
  series,
  missing,
  originalDescription,
  children,
}: {
  readonly hint: PlanningHintPresentation;
  readonly rest: RestTimeline | null;
  readonly series: WorkSeries | null;
  readonly missing: boolean;
  readonly originalDescription?: string;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  const body = { color: palette.textMuted, ...TYPOGRAPHY.body };
  const explanation = hint.compactTitle
    ? hint.explanation
    : "Für diesen Hinweis sind die Angaben nicht eindeutig auswertbar.";
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
  return (
    <View
      testID="planning-hint-detail-content"
      style={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, gap: SPACING.md }}
    >
      <Text style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}>
        {hint.title}
      </Text>
      <View style={{ gap: SPACING.sm }}>
        <Text style={body}>{explanation}</Text>
        {hint.recommendation ? <Text style={body}>{hint.recommendation}</Text> : null}
      </View>
      {additional.length ? (
        <CheckDetailDisclosure title="Weitere Angaben" testID="planning-original-details">
          {additional.map((text) => (
            <Text key={text} style={body}>
              {text}
            </Text>
          ))}
        </CheckDetailDisclosure>
      ) : null}
      {rest ? (
        <View style={{ gap: SPACING.xs }}>
          <Text style={body}>
            {dateLabel(rest.endDate)} · {rest.previous.endTime} bis {dateLabel(rest.startDate)} ·{" "}
            {rest.next.startTime}
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
      {hint.recoveryNote ? <Text style={body}>{hint.recoveryNote}</Text> : null}
      {hint.weekendAssessment ? (
        <WeekendAssessmentWindows assessment={hint.weekendAssessment} affectedOnly />
      ) : null}
      {missing ? (
        <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
      ) : null}
      {children}
      {hint.sources.length || hint.policyNote ? (
        <CheckDetailDisclosure title="Quelle und Prüfgrenzen" testID="planning-source-disclosure">
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
                  Alert.alert("Link nicht geöffnet", "Du kannst die Quelle später erneut öffnen.");
                });
              }}
              style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center", gap: SPACING.xs }}
            >
              <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>{source.title}</Text>
              <Text style={body}>{source.context}</Text>
            </Pressable>
          ))}
        </CheckDetailDisclosure>
      ) : null}
    </View>
  );
}
