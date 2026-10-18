import { RowButton, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { SharingParagraph, SharingStatus, type useSharingAction } from "./sharing-ui-elements";
import type { SharingController, SharingPublicationPreview } from "./sharing-ui-contract";

export function SharingPublicationRecovery({
  controller,
  action,
  calendarId,
  preview,
  onBack,
}: {
  readonly controller: SharingController;
  readonly action: ReturnType<typeof useSharingAction>;
  readonly calendarId: string;
  readonly preview: SharingPublicationPreview;
  readonly onBack: () => void;
}) {
  return (
    <>
      <SharingStatus busy={action.busy} failed={action.failed} message={action.failureMessage} />
      <SharingParagraph>
        Prüfe den Stand auf diesem Gerät. Nach Bestätigung werden künftige Änderungen wieder
        automatisch geteilt.
      </SharingParagraph>
      <SurfaceCard>
        {preview.entries.slice(0, 6).map((item, index) => (
          <RowButton key={index} title={item.title} subtitle={item.when} />
        ))}
      </SurfaceCard>
      <PrimaryButton
        disabled={action.busy}
        onPress={() =>
          void action.run(async () => {
            try {
              await controller.publishCalendar(calendarId, preview.confirmationId);
            } finally {
              onBack();
            }
          }, "Freigabe konnte nicht fortgesetzt werden. Prüfe den Stand erneut.")
        }
      >
        Freigabe fortsetzen
      </PrimaryButton>
    </>
  );
}
