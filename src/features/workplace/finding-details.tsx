import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useState } from "react";
import { usePflegeShiftEntries, usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import type { ShiftEntry } from "@/domain/types";
import { weekendEvidence } from "@/engine/planning-weekends";
import {
  workplaceFindingGroupKey,
  workplaceFindings,
  type WorkplaceFinding,
} from "@/engine/workplace-check";
import {
  CheckDetailCard,
  CheckDetailHeading,
  CheckDetailStack,
} from "@/features/analysis/check-detail-layout";
import { CheckDetailDisclosure } from "@/features/analysis/check-detail-disclosure";
import { checkPeriodLabel } from "@/features/analysis/check-period-label";
import { WeekendDuties } from "@/features/analysis/compliance-issue-content";
import { CheckDutyOverview } from "@/features/analysis/check-duty-overview";
import { usePalette } from "@/theme/palette";
import { CHECK_REFERENCE_TYPOGRAPHY } from "@/theme/typography";
import { InlineNotice } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { Text } from "@/ui/text";
import { topicIcons } from "./overview";
import { topics } from "./questions";
import { useWorkplaceData } from "./store";

const localDate = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3.$2.$1");

function occupiedWeekends(shifts: readonly ShiftEntry[], finding: WorkplaceFinding, zone: string) {
  const groups = new Map<string, string[]>();
  for (const shift of shifts) {
    for (const [saturday, evidence] of weekendEvidence(shift, zone)) {
      if (
        evidence.status !== "OCCUPIED" ||
        saturday < finding.periodStart ||
        saturday > finding.date
      )
        continue;
      const ids = groups.get(saturday);
      if (ids) ids.push(shift.id);
      else groups.set(saturday, [shift.id]);
    }
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([saturday, relatedShiftIds]) => ({
      saturday,
      sunday: Temporal.PlainDate.from(saturday).add({ days: 1 }).toString(),
      status: "OCCUPIED" as const,
      relatedShiftIds,
    }));
}

export function WorkplaceFindingDetails({
  period,
  groupKey,
}: {
  period: string;
  groupKey: string;
}) {
  const p = usePalette(),
    { data, save, error, retry, available } = useWorkplaceData();
  const { profile } = usePflegeShiftProfile(),
    { entries } = usePflegeShiftEntries();
  const zone = profile?.timeZone ?? "Europe/Berlin";
  const [saveError, setSaveError] = useState("");
  const group = useMemo(
    () =>
      data
        ? workplaceFindings(
            data,
            entries.filter((e) => e.kind === "SHIFT"),
            period,
            zone,
          ).filter((f) => workplaceFindingGroupKey(f) === groupKey)
        : [],
    [data, entries, period, zone, groupKey],
  );
  const finding = group[0];
  if (error)
    return (
      <CheckDetailCard title="Betriebsregeln">
        <InlineNotice message={error} />
        <SecondaryButton onPress={retry}>Erneut laden</SecondaryButton>
      </CheckDetailCard>
    );
  if (!finding)
    return (
      <CheckDetailCard>
        <Text style={{ ...CHECK_REFERENCE_TYPOGRAPHY.body, color: p.textMuted }}>
          {available && !data
            ? "Hinweis wird geladen …"
            : "Dieser Hinweis ist nicht mehr verfügbar."}
        </Text>
      </CheckDetailCard>
    );
  const shifts = [...new Map(finding.evidence().map((s) => [s.id, s])).values()];
  const body = { ...CHECK_REFERENCE_TYPOGRAPHY.body, color: p.textMuted };
  async function confirm(key: string, wasConfirmed: boolean) {
    try {
      await save((old) => ({
        ...old,
        exceptions: [...old.exceptions.filter((k) => k !== key), ...(wasConfirmed ? [] : [key])],
      }));
      setSaveError("");
    } catch {
      setSaveError("Die Bestätigung konnte nicht gespeichert werden.");
    }
  }
  return (
    <CheckDetailStack>
      <CheckDetailHeading
        kind="workplace"
        planningIcon={topicIcons[finding.topic]}
        title={localDate(finding.title)}
        period={checkPeriodLabel(finding.periodStart, finding.date)}
        caption="Betriebsregel"
      />
      <CheckDetailCard>
        {finding.topic === "weekend" ? (
          <WeekendDuties weekends={occupiedWeekends(shifts, finding, zone)} shifts={shifts} />
        ) : (
          <CheckDutyOverview shifts={shifts} timeZone={zone} testID="check-affected-shifts" />
        )}
      </CheckDetailCard>
      <CheckDetailCard title="Einordnung">
        <Text style={body}>{localDate(finding.detail)}</Text>
        <Text style={body}>{finding.assessment}</Text>
      </CheckDetailCard>
      <CheckDetailCard disclosure>
        <CheckDetailDisclosure title="Prüfgrundlage">
          <Text style={body}>
            {finding.topic === "time"
              ? "Für die Prüfung werden Beginn und Ende des Dienstes im Kalender benötigt."
              : "Deine Angabe unter „" +
                topics[finding.topic].title +
                "“ gilt für diesen Zeitraum. " +
                topics[finding.topic].basis}
          </Text>
        </CheckDetailDisclosure>
      </CheckDetailCard>
      {group
        .filter((f) => f.canConfirm)
        .map((f) => (
          <CheckDetailCard key={f.key} title={localDate(f.shiftLabel)}>
            <SecondaryButton onPress={() => void confirm(f.key, f.confirmed)}>
              {f.confirmed ? "Bestätigung zurücknehmen" : "Ausnahme auf meinen Wunsch bestätigen"}
            </SecondaryButton>
          </CheckDetailCard>
        ))}
      {!!saveError && <InlineNotice message={saveError} />}
    </CheckDetailStack>
  );
}
