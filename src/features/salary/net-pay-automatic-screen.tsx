import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { formatMonthTitle } from "@/engine/calendar";
import { FormScreen } from "@/ui/form-layout";
import { SectionHeader } from "@/ui/design-system";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { NetPayAutomaticEntryCard } from "./net-pay-automatic-entry-card";

export function NetPayAutomaticScreen({ month }: { readonly month: string }) {
  const root = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { testMonths } = usePflegeShiftTestData();
  if (root.ready && root.error)
    return <LoadFailureView message={root.error} onRetry={() => void root.reload()} />;
  if (!root.ready || !profile) return <LoadingView />;
  return (
    <FormScreen>
      <SectionHeader title="Gehaltsprognose" caption={formatMonthTitle(month)} />
      <NetPayAutomaticEntryCard
        month={month}
        proposedGrossCents={null}
        blocked={testMonths.includes(month)}
      />
    </FormScreen>
  );
}
