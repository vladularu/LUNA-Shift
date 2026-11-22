import { Temporal } from "@js-temporal/polyfill";
import { useRef, useState, type ComponentProps } from "react";
import type { WorkplaceData } from "@/domain/workplace-rules";
import { RuleFlow, type Save } from "@/features/workplace/rule-flow";

export type WorkplaceUpdate = Parameters<Save>[0];

export function OnboardingWorkplace({
  initial,
  complete,
  presentation,
}: {
  initial: WorkplaceData;
  complete: (update: WorkplaceUpdate) => void;
  presentation: NonNullable<ComponentProps<typeof RuleFlow>["onboarding"]>;
}) {
  const [draft, setDraft] = useState(initial);
  const [today] = useState(() => Temporal.Now.plainDateISO("Europe/Berlin").toString());
  const updates = useRef<WorkplaceUpdate[]>([]);

  const saveDraft: Save = async (update) => {
    setDraft((current) => update(current));
    updates.current.push(update);
  };

  return (
    <RuleFlow
      entry="intro"
      data={draft}
      today={today}
      onboarding={presentation}
      save={saveDraft}
      onClose={() => {
        const completedUpdates = updates.current.slice();
        complete((current) => completedUpdates.reduce((data, update) => update(data), current));
      }}
    />
  );
}
