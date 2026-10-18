import { useContext } from "react";
import { router } from "expo-router";
import Ionicons from "@/ui/icon";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { RowButton, SurfaceCard } from "@/ui/design-system";
import type { PrivateCloudStatus } from "@/application/private-cloud-runtime";

const labels: Record<PrivateCloudStatus["phase"], string> = {
  signed_out: "Nicht angemeldet",
  disabled: "Pausiert",
  setup: "Auswahl erforderlich",
  syncing: "Wird abgeglichen …",
  synced: "Aktiv",
  conflict: "Auswahl erforderlich",
  error: "Abgleich offen",
};

export function accountCloudStatusLabel(phase: PrivateCloudStatus["phase"], ready = true) {
  return ready ? labels[phase] : "Wird geladen …";
}

export function AccountSyncNotice() {
  const cloud = useContext(PrivateCloudContext);
  if (!cloud?.user || !cloud.ready) return null;
  const phase = cloud.status.phase;
  if (phase !== "setup" && phase !== "conflict" && phase !== "error") return null;
  return (
    <SurfaceCard>
      <RowButton
        title={phase === "error" ? "Sync erneut versuchen" : "Daten auswählen"}
        subtitle={
          phase === "error"
            ? "Deine Änderungen bleiben auf diesem Gerät."
            : phase === "setup"
              ? "Dieses Gerät war mit einem anderen Konto verbunden."
              : "Gerät und Cloud unterscheiden sich."
        }
        subtitleBelow
        onPress={() => {
          if (phase === "error") void cloud.runtime.synchronize();
          else router.push("/private-cloud");
        }}
      />
    </SurfaceCard>
  );
}

export function AccountCloudStatus({ compact = false }: { readonly compact?: boolean }) {
  const cloud = useContext(PrivateCloudContext);
  const palette = usePalette();
  const phase = cloud?.status.phase ?? "signed_out";
  const label = accountCloudStatusLabel(phase, !cloud || cloud.ready);
  return compact ? (
    <Ionicons
      name={cloud?.ready && phase === "synced" ? "cloud-done-outline" : "cloud-outline"}
      size={24}
      color={phase === "synced" ? palette.primary : palette.textMuted}
      accessibilityLabel={`Cloud: ${label}`}
    />
  ) : (
    <>
      <Text
        accessibilityLiveRegion="polite"
        style={{ ...TYPOGRAPHY.caption, color: palette.textSecondary, textAlign: "center" }}
      >
        Sync-Status: {label}
      </Text>
      {cloud?.status.lastSyncedAt ? (
        <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted, textAlign: "center" }}>
          Letzter Sync:{" "}
          {new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
            new Date(cloud.status.lastSyncedAt),
          )}
        </Text>
      ) : null}
    </>
  );
}
