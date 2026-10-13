import { Linking, Platform, Share } from "react-native";
import type { SharingDeliveryChannel } from "@/domain/sharing-ui-contract";

export function invitationDeliveryUrl(
  url: string,
  channel: Exclude<SharingDeliveryChannel, "system" | "copy">,
  ios: boolean,
): string {
  const message = encodeURIComponent(`Ich möchte meinen LUNA-Kalender mit dir teilen. ${url}`);
  switch (channel) {
    case "messages":
      return `sms:${ios ? "&" : "?"}body=${message}`;
    case "whatsapp":
      return `whatsapp://send?text=${message}`;
    case "telegram":
      return `tg://msg_url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Mein LUNA-Kalender")}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent("Einladung zu meinem LUNA-Kalender")}&body=${message}`;
  }
}

/** Opens a draft or the system chooser; the user chooses the recipient and sends. */
export async function deliverSharingInvitation(
  url: string,
  channel: SharingDeliveryChannel = "system",
): Promise<void> {
  if (channel !== "system" && channel !== "copy") {
    try {
      // openURL needs no new LSApplicationQueriesSchemes, unlike canOpenURL.
      await Linking.openURL(invitationDeliveryUrl(url, channel, Platform.OS === "ios"));
      return;
    } catch {
      // Missing mail/messenger applications still leave a working system share action.
    }
  }
  await Share.share({ message: `Ich möchte meinen LUNA-Kalender mit dir teilen. ${url}`, url });
}
