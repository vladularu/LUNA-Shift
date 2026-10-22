import { SharingRuntimeProvider } from "@/composition/calendar-sharing-provider";
import { useSQLiteContext } from "expo-sqlite";
import { useMemo, type PropsWithChildren } from "react";
import { PflegeShiftProvider } from "@/application/pflegeshift-provider";
import { RuleCatalogRuntimeProvider } from "@/application/rule-catalog-runtime-provider";
import { createPflegeShiftPorts } from "@/composition/create-pflegeshift-ports";
import { createRuleCatalogRuntimePort } from "@/composition/create-rule-catalog-runtime-port";
import { useDataMonth } from "@/navigation/use-data-month";
import { CalendarWidgetSync } from "@/features/widgets/calendar-widget-sync";
import { useSharingStartup } from "./use-sharing-startup";
export function PflegeShiftRuntimeProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const sharingStartup = useSharingStartup(db);
  const activeMonth = useDataMonth();
  const ports = useMemo(() => createPflegeShiftPorts(db), [db]);
  const ruleCatalog = useMemo(() => createRuleCatalogRuntimePort(db), [db]);
  return (
    <PflegeShiftProvider activeMonth={activeMonth} ports={ports}>
      <RuleCatalogRuntimeProvider {...ruleCatalog}>
        <SharingRuntimeProvider startup={sharingStartup}>
          <CalendarWidgetSync ports={ports} />
          {children}
        </SharingRuntimeProvider>
      </RuleCatalogRuntimeProvider>
    </PflegeShiftProvider>
  );
}
