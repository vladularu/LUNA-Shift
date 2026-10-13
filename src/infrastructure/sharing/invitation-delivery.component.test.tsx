import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Linking, Share } from "react-native";
import { deliverSharingInvitation, invitationDeliveryUrl } from "./invitation-delivery";

const url = "https://luna.example/sharing-invite?token=" + "ab".repeat(32);
beforeEach(() => {
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
});
describe("Einladungsversand", () => {
  it.each(["messages", "whatsapp", "telegram", "email"] as const)(
    "opens a draft for %s without sending or opening an extra chooser",
    async (channel) => {
      await deliverSharingInvitation(url, channel);
      const opened = jest.mocked(Linking.openURL).mock.calls[0][0];
      expect(decodeURIComponent(opened)).toContain(url);
      expect(Share.share).not.toHaveBeenCalled();
    },
  );
  it("uses the platform SMS syntax and preserves the invitation query", () => {
    expect(invitationDeliveryUrl(url, "messages", true)).toMatch(/^sms:&body=/);
    expect(invitationDeliveryUrl(url, "messages", false)).toMatch(/^sms:\?body=/);
    expect(decodeURIComponent(invitationDeliveryUrl(url, "telegram", true))).toContain(url);
  });
  it("falls back to the system chooser when an application is missing", async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("app unavailable"));
    await deliverSharingInvitation(url, "whatsapp");
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });
  it("uses the system chooser for AirDrop without trying a messenger URL", async () => {
    await deliverSharingInvitation(url, "system");
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(Share.share).toHaveBeenCalledTimes(1);
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });
});
