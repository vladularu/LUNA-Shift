import type { PropsWithChildren } from "react";
import { MessageCircle, Mail, Send, Share2 } from "lucide-react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { CardSeparator, RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { SharingQr } from "./sharing-qr";
import { SharingParagraph } from "./sharing-ui-elements";
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
  const channels = [
    { id: "messages" as const, label: "Mit Nachrichten einladen", Icon: MessageCircle },
    { id: "whatsapp" as const, label: "Mit WhatsApp einladen", Icon: MessageCircle },
    { id: "telegram" as const, label: "Mit Telegram einladen", Icon: Send },
    { id: "email" as const, label: "Mit E-Mail einladen", Icon: Mail },
    { id: "system" as const, label: "Sonstige (AirDrop)", Icon: Share2 },
  ];
  return (
    <>
      <SurfaceCard>
        {channels.map(({ id, label, Icon }, index) => (
          <SurfaceCardRow key={id} separator={index > 0}>
            <RowButton
              title={label}
              disabled={busy}
              onPress={() => onSend(id)}
              leading={<Icon size={24} color={palette.primary} accessible={false} />}
              trailing={null}
            />
          </SurfaceCardRow>
        ))}
      </SurfaceCard>
      <SectionHeader title="Oder per QR-Code teilen" />
      <SharingParagraph>
        Andere scannen diesen Code mit ihrer Kamera, um deinem Kalender beizutreten.
      </SharingParagraph>
      <SurfaceCard style={{ padding: SPACING.xl }}>
        <SharingQr url={url} />
      </SurfaceCard>
    </>
  );
}
function SurfaceCardRow({
  separator,
  children,
}: PropsWithChildren<{ readonly separator: boolean }>) {
  return (
    <>
      {separator ? <CardSeparator /> : null}
      {children}
    </>
  );
}
