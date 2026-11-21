import { Temporal } from "@js-temporal/polyfill";
import { Fragment, type ReactNode, useState } from "react";
import Icon from "@/ui/icon";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { topicIcons } from "./overview";
import { View } from "react-native";
import {
  CheckInboxRow,
  compactCheckPeriod,
  openCheckIssueDetails,
} from "@/features/analysis/compliance-issue-content";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import type { WorkplaceData } from "@/domain/workplace-rules";
import { useWorkplaceGroups } from "./check-summary";
import {
  CardSeparator,
  InlineNotice,
  SectionHeader,
  RowButton,
  SurfaceCard,
} from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { SPACING } from "@/theme/tokens";
import { useWorkplaceData } from "./store";
import { RuleFlow, type Save } from "./rule-flow";
export function WorkplacePanel({
  period,
  restKeys,
  children,
}: {
  children?: (count: number) => ReactNode;
  period?: string;
  restKeys?: readonly string[];
}) {
  const { available, data, error, retry, save } = useWorkplaceData();
  if (!available) return children?.(0) ?? null;
  if (error)
    return (
      <>
        {children?.(0)}
        <InlineNotice message={error} />
        <SecondaryButton onPress={retry}>Erneut laden</SecondaryButton>
      </>
    );
  if (!data) return children?.(0) ?? null;
  return (
    <WorkplaceContent period={period} data={data} save={save} restKeys={restKeys}>
      {children}
    </WorkplaceContent>
  );
}
function WorkplaceContent({
  period,
  data,
  save,
  restKeys,
  children,
}: {
  children?: (count: number) => ReactNode;
  period?: string;
  restKeys?: readonly string[];
  data: WorkplaceData;
  save: Save;
}) {
  const { profile } = usePflegeShiftProfile();
  const p = usePalette();
  const zone = profile?.timeZone ?? "Europe/Berlin";
  const [overview, setOverview] = useState(false);
  const [take, setTake] = useState(10);
  const grouped = useWorkplaceGroups(data, period, restKeys);
  const localDate = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3.$2.$1");
  if (period && data.handled && !overview && !data.history.length) return children?.(0) ?? null;
  return (
    <>
      {children?.(grouped.length)}
      <View style={{ gap: SPACING.sm }}>
        {!period && (
          <>
            <SectionHeader title="Betriebliche Regeln" />
            <SurfaceCard>
              <RowButton
                leading={<Icon name="options-outline" size={20} />}
                title="Sonderregelungen in deinem Betrieb"
                subtitle="Dienstplanung, Nachtarbeit und Ruhezeiten"
                titleColor={p.text}
                onPress={() => setOverview(true)}
              />
            </SurfaceCard>
          </>
        )}
        {(overview || (period && !data.handled)) && (
          <RuleFlow
            data={data}
            today={Temporal.Now.plainDateISO(zone).toString()}
            entry={overview ? "overview" : "intro"}
            save={save}
            onClose={() => setOverview(false)}
          />
        )}
        {period && grouped.length > 0 && (
          <>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ ...TYPOGRAPHY.small, fontWeight: "600", color: p.textMuted }}
            >
              Betriebsregeln
            </Text>
            <SurfaceCard style={{ overflow: "hidden" }}>
              {grouped.slice(0, take).map(([key, group], idx) => {
                const f = group[0];
                const when =
                  compactCheckPeriod({ from: f.periodStart, until: f.date }) ?? localDate(f.date);
                return (
                  <Fragment key={key}>
                    {idx > 0 && <CardSeparator />}
                    <CheckInboxRow
                      title={localDate(f.title)}
                      label={`Details ansehen: ${localDate(f.title)}`}
                      subtitle={when}
                      icon={topicIcons[f.topic]}
                      accent={p.textMuted}
                      hint="Öffnet die Betriebsregel und die zugehörigen Dienste"
                      onPress={() => openCheckIssueDetails({ workplace: { period, key } })}
                    />
                  </Fragment>
                );
              })}
            </SurfaceCard>
          </>
        )}
        {take < grouped.length && (
          <SecondaryButton onPress={() => setTake(take + 10)}>
            Weitere Hinweise anzeigen
          </SecondaryButton>
        )}
      </View>
    </>
  );
}
