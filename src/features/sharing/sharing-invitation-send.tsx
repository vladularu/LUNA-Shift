import { Share2 } from "lucide-react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { SharingQr } from "./sharing-qr";
import type { SharingDeliveryChannel } from "./sharing-ui-contract";

export function SharingInvitationSend({
  url,
  busy,
  onSend,
}: {
  readonly url: string;
  readonly busy: boolean;
  readonly onSend: (channel: SharingDeliveryChannel) => void;
}) {
  const palette = usePalette();
  return (
    <>
      <SectionHeader title="QR" />
      <SurfaceCard style={{ padding: SPACING.xl }}>
        <SharingQr url={url} />
      </SurfaceCard>
      <SurfaceCard>
        <RowButton
          title="Sonstige"
          disabled={busy}
          onPress={() => onSend("system")}
          leading={<Share2 size={24} color={palette.primary} accessible={false} />}
          trailing={null}
        />
      </SurfaceCard>
    </>
  );
}
