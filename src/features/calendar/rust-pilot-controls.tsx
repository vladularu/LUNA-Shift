import { File, Paths } from "expo-file-system";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { getNativeRestPilot, loadRestPilotComparison } from "../../../modules/luna-rest-pilot";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import { usePalette } from "@/theme/palette";
import { RowButton } from "@/ui/design-system";
import { shareCalendarPerformanceFile } from "./share-calendar-performance";

export function RustPilotControls({ subtitleBelow = false }: { readonly subtitleBelow?: boolean }) {
  const palette = usePalette();
  const [status, setStatus] = useState("");
  const [hasReport, setHasReport] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const report = useRef<Awaited<
    ReturnType<typeof import("../../../modules/luna-rest-pilot/benchmark").runRestPilot>
  > | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  if (!DEV_TOOLS_AVAILABLE || Platform.OS !== "ios") return null;
  const run = async () => {
    if (busy.current) return;
    const native = getNativeRestPilot();
    if (!native) {
      Alert.alert(
        "Neuer Preview-Build erforderlich",
        "Dieser Build enthält den nativen Rust-Piloten noch nicht.",
      );
      return;
    }
    busy.current = true;
    report.current = null;
    setHasReport(false);
    controller.current = new AbortController();
    try {
      // Keep synthetic fixtures and the comparison out of normal startup work.
      const { runRestPilot } = loadRestPilotComparison();
      report.current = await runRestPilot(native, {
        signal: controller.current.signal,
        progress: (text) => {
          if (mounted.current) setStatus(text);
        },
      });
      if (mounted.current) {
        setHasReport(true);
        setStatus("Alle Ergebnisse stimmen überein");
      }
    } catch {
      if (mounted.current) {
        setStatus("Vergleich nicht abgeschlossen");
        Alert.alert(
          "Rust-Vergleich nicht abgeschlossen",
          "Bitte erneut versuchen. Ein Ergebnisvergleich oder der native Aufruf ist fehlgeschlagen.",
        );
      }
    } finally {
      busy.current = false;
    }
  };
  const share = async () => {
    if (busy.current || !report.current) return;
    busy.current = true;
    try {
      const value = {
        ...report.current,
        updateId: Updates.updateId,
        runtime: Updates.runtimeVersion,
        embedded: Updates.isEmbeddedLaunch,
        appVersion: Constants.expoConfig?.version,
        buildNumber: Constants.expoConfig?.ios?.buildNumber,
        os: Platform.Version,
      };
      await shareCalendarPerformanceFile(
        JSON.stringify(value, null, 2),
        new File(Paths.cache, `LUNA-Rust-Vergleich-${Date.now()}.json`),
      );
    } catch {
      if (mounted.current) Alert.alert("Bericht nicht geteilt", "Bitte erneut versuchen.");
    } finally {
      busy.current = false;
    }
  };
  return (
    <>
      <RowButton
        titleColor={palette.text}
        subtitleBelow={subtitleBelow}
        title="Rust-Vergleich starten"
        subtitle={status || "Vergleicht Beispieldaten lokal. Deine Dienste bleiben unverändert."}
        onPress={() => {
          void run();
        }}
      />
      {hasReport && (
        <RowButton
          titleColor={palette.text}
          subtitleBelow={subtitleBelow}
          title="Rust-Bericht teilen"
          onPress={() => {
            void share();
          }}
        />
      )}
    </>
  );
}
