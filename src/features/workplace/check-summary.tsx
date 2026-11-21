import { useContext, useMemo, type ReactNode } from "react";
import { usePflegeShiftEntries, usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { rulesAt, type WorkplaceData } from "@/domain/workplace-rules";
import { workplaceFindingGroupKey, workplaceFindings } from "@/engine/workplace-check";
import { WorkplaceDataContext } from "./store";

export function useWorkplaceGroups(
  data: WorkplaceData,
  period?: string,
  restKeys?: readonly string[],
) {
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const zone = profile?.timeZone ?? "Europe/Berlin";
  const findings = useMemo(
    () =>
      period && data.history.length
        ? workplaceFindings(
            data,
            entries.filter((entry) => entry.kind === "SHIFT"),
            period,
            zone,
          )
        : [],
    [data, entries, period, zone],
  );
  return useMemo(() => {
    const byKey = new Map<string, typeof findings>();
    const legalRest = new Set(restKeys);
    for (const finding of findings) {
      if (finding.durationEvidenceKey && legalRest.has(finding.durationEvidenceKey)) continue;
      const key = workplaceFindingGroupKey(finding);
      const group = byKey.get(key);
      if (group) group.push(finding);
      else byKey.set(key, [finding]);
    }
    return [...byKey.entries()];
  }, [findings, restKeys]);
}

type SummaryProps = {
  period: string;
  restKeys?: readonly string[];
  children: (count?: number) => ReactNode;
};

export function WorkplaceCheckSummary({ period, restKeys, children }: SummaryProps) {
  const data = useContext(WorkplaceDataContext);
  if (!data?.history.length) return children();
  const start = period + (period.length === 4 ? "-01-01" : "-01");
  const rules = [
    rulesAt(data.history, start),
    ...data.history
      .filter((change) => change.from > start && change.from.startsWith(period))
      .map((change) => change.rules),
  ];
  if (
    !rules.some((group) =>
      Object.values(group).some((rule) => rule && rule.mode !== "none" && rule.mode !== "unknown"),
    )
  )
    return children();
  return (
    <ConfiguredSummary data={data} period={period} restKeys={restKeys}>
      {children}
    </ConfiguredSummary>
  );
}

function ConfiguredSummary({
  data,
  period,
  restKeys,
  children,
}: SummaryProps & { data: WorkplaceData }) {
  const groups = useWorkplaceGroups(data, period, restKeys);
  return children(groups.length);
}
