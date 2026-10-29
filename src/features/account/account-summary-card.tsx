import { useContext } from "react";
import { Image, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@/ui/icon";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { RowButton, SurfaceCard } from "@/ui/design-system";
import { Text } from "@/ui/text";
import { AccountCloudStatus, accountCloudStatusLabel } from "./account-status";

export function AccountSummaryCard() {
  const cloud = useContext(PrivateCloudContext);
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const user = cloud?.ready ? cloud.user : null;
  const title = user?.displayName || (cloud && !cloud.ready ? "Wird geladen …" : "Anmelden");
  const syncLabel = accountCloudStatusLabel(
    cloud?.status.phase ?? "signed_out",
    !cloud || cloud.ready,
  );
  const initials = user?.displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => Array.from(part)[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("de-DE");
  return (
    <SurfaceCard>
      <RowButton
        accessibilityLabel="Konto"
        accessibilityHint={`${title}. Cloud: ${syncLabel}`}
        title={title}
        subtitle="LUNA Cloud"
        subtitleBelow={fontScale >= 1.3}
        leading={
          <View
            accessible={false}
            style={{
              width: 48,
              height: 48,
              borderRadius: RADII.pill,
              backgroundColor: palette.surfaceMuted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {user && cloud?.photo?.uri ? (
              <Image
                source={{ uri: cloud.photo.uri }}
                accessibilityLabel="Profilbild"
                style={{ width: 48, height: 48, borderRadius: RADII.pill }}
              />
            ) : initials && fontScale < 1.3 ? (
              <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>{initials}</Text>
            ) : (
              <Ionicons name="person-outline" size={24} color={palette.text} />
            )}
          </View>
        }
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
            <AccountCloudStatus compact />
            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.textMuted}
              accessible={false}
            />
          </View>
        }
        onPress={() => router.push("/account")}
      />
    </SurfaceCard>
  );
}
