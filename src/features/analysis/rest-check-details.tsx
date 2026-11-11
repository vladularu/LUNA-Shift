import { Alert, Linking, Pressable, View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import type { RuleResolver } from "@/rules/rule-resolver";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { CheckDutyOverview } from "./check-duty-overview";
import { complianceTimeline, restDuration, type RestTimeline } from "./compliance-timeline";
import { checkPeriodLabel } from "./check-period-label";
import { CheckDetailCard, CheckDetailStack } from "./check-detail-layout";
import { AnalysisDetailSummaryCard } from "./analysis-detail-layout";
import { CheckDetailDisclosure } from "./check-detail-disclosure";

const sourceUrl = "https://www.gesetze-im-internet.de/arbzg/__5.html";
const exceptions = "Betriebliche Ausnahmen sind nicht geprüft.";

interface RestCheckDetailModel {
  readonly rest: RestTimeline;
  readonly minimumMinutes: number;
  readonly regularMinutes: number | null;
  readonly differenceMinutes: number;
  readonly period: string;
}

/** Display only: a recorded finding and its exact available duties must agree. */
export function restCheckDetailModel(
  issue: ComplianceIssue,
  shifts: readonly ShiftEntry[],
  timeZone: string,
  resolver?: RuleResolver,
): RestCheckDetailModel | null {
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  if (issue.kind !== "LEGAL" || issue.tariff || facts?.rule !== "ARBZG_5_REST_10H") return null;
  const timeline = complianceTimeline(issue, shifts, timeZone);
  const rest = timeline.rest;
  if (
    timeline.missing ||
    !rest ||
    rest.minutes !== facts.restMinutes ||
    facts.minimumRestMinutes <= 0 ||
    rest.minutes >= facts.minimumRestMinutes
  )
    return null;
  const legal = resolver?.resolveLegal(issue.date);
  const regularMinutes = legal?.ok ? legal.value.rules.restPeriod.defaultMinutes : null;
  const dateRange = checkPeriodLabel(rest.endDate, rest.startDate);
  return {
    rest,
    minimumMinutes: facts.minimumRestMinutes,
    regularMinutes,
    differenceMinutes: facts.minimumRestMinutes - rest.minutes,
    period: dateRange,
  };
}

export function RestCheckDetails({ model }: { readonly model: RestCheckDetailModel }) {
  const palette = usePalette();
  const shortened = model.regularMinutes !== null && model.minimumMinutes < model.regularMinutes;
  const divider = {
    borderTopWidth: 1,
    borderTopColor: palette.cardSeparator,
    paddingTop: SPACING.lg,
  };
  const heading = { color: palette.text, ...TYPOGRAPHY.bodyStrong };
  const secondary = { color: palette.textMuted, ...TYPOGRAPHY.small };
  const row = {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
  };
  return (
    <CheckDetailStack testID="rest-check-details">
      <AnalysisDetailSummaryCard
        period={model.period}
        title="Kurzer Wechsel"
        caption="Gesetzliche Prüfung · Ruhezeit"
      />
      <CheckDetailCard accent={palette.legalCheckBorder}>
        <CheckDutyOverview
          shifts={[model.rest.previous, model.rest.next]}
          compact={false}
          showTimes
          testID="rest-check-duties"
        />
        <View style={{ ...divider, gap: SPACING.xs }}>
          <Text style={secondary}>Deine Ruhezeit</Text>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.highlightValue }}>
            {restDuration(model.rest.minutes)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: SPACING.sm }}>
          <Ionicons
            name="alert-circle-outline"
            color={palette.legalCheckBorder}
            size={22}
            accessibilityElementsHidden
          />
          <View style={{ flex: 1, gap: SPACING.xs }}>
            <Text style={{ ...heading, color: palette.legalCheckBorder }}>
              Prüfmaßstab unterschritten
            </Text>
            <Text style={secondary}>
              {restDuration(model.differenceMinutes)} unter{" "}
              {shortened ? "der verkürzten Ruhezeit" : "dem verwendeten Prüfmaßstab"}.
            </Text>
          </View>
        </View>
      </CheckDetailCard>
      <CheckDetailCard>
        <CheckDetailDisclosure title="Prüfgrundlage">
          <View style={row}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Arbeitszeitgesetz · § 5 Ruhezeit"
              onPress={() => {
                void Linking.openURL(sourceUrl).catch(() =>
                  Alert.alert(
                    "Quelle nicht geöffnet",
                    "Du kannst die Quelle später erneut öffnen.",
                  ),
                );
              }}
              style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center" }}
            >
              <Text style={secondary}>§ 5 ArbZG</Text>
            </Pressable>
          </View>
          {model.regularMinutes !== null && model.regularMinutes !== model.minimumMinutes ? (
            <View style={row}>
              <Text style={secondary}>Regulär</Text>
              <Text style={heading}>{restDuration(model.regularMinutes)}</Text>
            </View>
          ) : null}
          <View style={row}>
            <Text style={secondary}>
              {shortened ? "Verkürzt · mit Ausgleich" : "Verwendeter Prüfmaßstab"}
            </Text>
            <Text style={heading}>{restDuration(model.minimumMinutes)}</Text>
          </View>
          <Text style={secondary}>{exceptions}</Text>
        </CheckDetailDisclosure>
      </CheckDetailCard>
    </CheckDetailStack>
  );
}
