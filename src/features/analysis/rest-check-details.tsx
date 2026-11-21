import { Alert, Linking, Pressable, View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import type { RuleResolver } from "@/rules/rule-resolver";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { CheckRestTimeline, formatCheckRestDuration } from "./check-rest-timeline";
import { complianceTimeline, restDuration, type RestTimeline } from "./compliance-timeline";
import { checkPeriodLabel } from "./check-period-label";
import {
  CheckDetailCard,
  checkSourceLinkStyle,
  CheckDetailStack,
  CheckDetailHeading,
  useCheckReferenceDetail,
} from "./check-detail-layout";
import { CheckDetailDisclosure } from "./check-detail-disclosure";

const sourceUrl = "https://www.gesetze-im-internet.de/arbzg/__5.html";
const exceptions = "Betriebliche Ausnahmen sind nicht geprüft.";

interface RestCheckDetailModel {
  readonly rest: RestTimeline;
  readonly agreement?: boolean;
  readonly additionalMinimum?: number;
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
    ...(issue.workplaceRestMinimum === facts.minimumRestMinutes ? { agreement: true } : {}),
    ...(issue.workplaceRestMinimum && issue.workplaceRestMinimum > facts.minimumRestMinutes
      ? { additionalMinimum: issue.workplaceRestMinimum }
      : {}),
    minimumMinutes: facts.minimumRestMinutes,
    regularMinutes,
    differenceMinutes: facts.minimumRestMinutes - rest.minutes,
    period: dateRange,
  };
}

export function RestCheckDetails({ model }: { readonly model: RestCheckDetailModel }) {
  const palette = usePalette();
  const reference = useCheckReferenceDetail();
  const shortened = model.regularMinutes !== null && model.minimumMinutes < model.regularMinutes;
  const heading = { color: palette.text, ...TYPOGRAPHY.bodyStrong };
  const secondary = reference
    ? { ...CHECK_REFERENCE_TYPOGRAPHY.body, color: reference.secondary }
    : { color: palette.textMuted, ...TYPOGRAPHY.small };
  const row = {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
  };
  return (
    <CheckDetailStack testID="rest-check-details">
      <CheckDetailHeading
        kind="legal"
        period={model.period}
        title="Kurze Ruhezeit"
        caption={
          model.agreement
            ? "Ruhezeit · mit betrieblicher Vereinbarung"
            : "Gesetzliche Prüfung · Ruhezeit"
        }
      />
      <CheckDetailCard
        accent={reference?.legalLine ?? palette.legalCheckBorder}
        testID="rest-check-timeline-card"
      >
        <CheckRestTimeline rest={model.rest} testID="rest-check-duties" />
      </CheckDetailCard>
      <CheckDetailCard title="Wie wird das eingeordnet?">
        {reference ? (
          <Text style={secondary}>
            Die erfasste Ruhezeit liegt {formatCheckRestDuration(model.differenceMinutes)} unter dem
            Prüfmaßstab von {formatCheckRestDuration(model.minimumMinutes)}.
          </Text>
        ) : (
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
        )}
      </CheckDetailCard>
      <CheckDetailCard disclosure>
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
              <Text style={[secondary, checkSourceLinkStyle(palette)]}>§ 5 ArbZG</Text>
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
          {model.additionalMinimum ? (
            <Text style={secondary}>
              In deinem Betrieb sind mindestens {formatCheckRestDuration(model.additionalMinimum)}{" "}
              vereinbart.
            </Text>
          ) : null}
          <Text style={secondary}>
            {model.agreement
              ? "Für diese Dienste verwendet LUNA die Mindestdauer, die du als vereinbart eingetragen hast."
              : exceptions}
          </Text>
        </CheckDetailDisclosure>
      </CheckDetailCard>
    </CheckDetailStack>
  );
}
