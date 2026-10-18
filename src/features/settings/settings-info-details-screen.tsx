import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { PRODUCT_NAME } from "@/brand";
import type { SettingsInfoSection } from "@/navigation/routes";
import { APP_RUNTIME_LABEL } from "@/infrastructure/app-version";
import { parseEnumRouteParam, type RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { SurfaceCard } from "@/ui/design-system";
import { LoadFailureView } from "@/ui/loading-view";
import { BackFooterLayout } from "@/ui/back-footer-layout";

interface InfoContent {
  readonly title: string;
  readonly intro: string;
  readonly items: readonly {
    readonly title: string;
    readonly text: string;
  }[];
}

const INFO_CONTENT: Readonly<Record<SettingsInfoSection, InfoContent>> = {
  STORAGE: {
    title: "Lokale Datenspeicherung",
    intro:
      "LUNA funktioniert offline und ohne Konto. Deine Daten werden auf diesem Gerät gespeichert.",
    items: [
      {
        title: "Kein Konto erforderlich",
        text: "Dienste, Termine, Tarifprofil und Einstellungen sind auch ohne Anmeldung offline nutzbar.",
      },
      {
        title: "Kalender teilen ist optional",
        text: "Zum Teilen oder Annehmen einer Einladung brauchst du ein Konto. Andere können die Inhalte nur ansehen. Deine Freigaben kannst du jederzeit beenden. Empfangene Kalender sind offline höchstens 24 Stunden sichtbar. Erkennt LUNA einen Widerruf, entfernt sie den Kalender sofort.",
      },
      {
        title: "Privates Cloud-Konto ist optional",
        text: "Nach deiner ausdrücklichen Auswahl sichert und synchronisiert dein Cloud-Konto die eigenen Daten, einschließlich Notizen, Gehalts- und Steuerangaben sowie Kalenderfoto. Andere LUNA-Nutzer haben darauf keinen Zugriff. Die Daten sind bei der Übertragung und beim Anbieter verschlüsselt. Die aktuelle Sicherung bleibt erhalten, dazu höchstens eine ältere Sicherung pro Tag für die letzten 30 Kalendertage.",
      },
      {
        title: "Backup selbst ablegen",
        text: "Unter Mehr → Datensicherung kannst du zusätzlich eine lokale Backup-Datei erstellen, vor dem Wiederherstellen prüfen und außerhalb der App sicher ablegen. Eine Deinstallation kann lokale Daten löschen.",
      },
      {
        title: "Löschen",
        text: "Gelöschte Dienste und Termine sind sofort ausgeblendet. Ihre Daten bleiben mindestens 90 Tage verschlüsselt auf dem Gerät. Bei ausstehender Freigabeübertragung warten sie zusätzlich auf die Serverbestätigung. Vorlagen bleiben gespeichert, solange Dienste oder ein offenes Testlabor-Backup sie benötigen.",
      },
      {
        title: "Ortssuche",
        text: "Ab drei Zeichen geht deine Suche an Apple (iOS) oder den systemseitigen Geocoder (Android), nicht an einen LUNA Shift-Server. Deine aktuelle GPS-Position wird nicht abgefragt. Android kann dafür trotzdem eine Standortberechtigung verlangen.",
      },
      {
        title: "Karten",
        text: "Die Vorschau lädt Karten von Apple (iOS) oder Google (Android). Beim Öffnen einer Karten-App gehen die Koordinaten an Apple Karten oder Google Maps. Ortsname, Adresse und Koordinaten bleiben außerdem verschlüsselt auf deinem Gerät.",
      },
      {
        title: "Datenschutz",
        text: "Nur von dir ausgewählte Dienste, Termine und Notizen werden beim Erstellen der Einladung in der LUNA-Cloud gespeichert. Orte, Gehalts- und Steuerdaten werden nicht in der Kalenderfreigabe geteilt. Die private Cloud-Sicherung umfasst diese eigenen Daten und wird erst nach deiner ausdrücklichen Auswahl aktiviert. Für Ortssuche und Karten gelten auch die Datenschutzbedingungen von Apple beziehungsweise Google.",
      },
    ],
  },
  CALCULATION: {
    title: "Berechnungshinweise",
    intro:
      "Alle Auswertungen werden lokal aus deinem Arbeitszeitmodell, deinen Diensten und deinem Tarifprofil abgeleitet.",
    items: [
      {
        title: "Arbeitszeit",
        text: "Ist-Zeit entspricht der Dienstzeit abzüglich Pause. Für eine vollständige ArbZG-Prüfung müssen Arbeitszeiten aus allen Arbeitsverhältnissen erfasst sein.",
      },
      {
        title: "Pausendauer",
        text: `Für die einfache Dienst- und Monatsberechnung speichert ${PRODUCT_NAME} bewusst nur die gesamte Pausendauer. Pausenbeginn und einzelne Abschnitte müssen nicht nachgetragen werden.`,
      },
      {
        title: "Feiertage und Zuschläge",
        text: "Bundesland, regionale Feiertage am Arbeitsort, Uhrzeit und Tarifstand bestimmen Feiertage und Zuschläge. Überschneidungen werden minutengenau aufgeteilt.",
      },
      {
        title: "Tarifüberstunden",
        text: "Eingetragene Mehrzeit wird nur als TVöD-Überstunde vergütet, wenn sie im Dienst ausdrücklich als tariflich bestätigt markiert wurde.",
      },
      {
        title: "Schätzung statt Abrechnung",
        text: "Gehalt und Hinweise sind eine Orientierung, keine Lohnabrechnung oder Rechtsberatung. Maßgeblich bleiben Dienstvereinbarung, Tarifvertrag und Abrechnung.",
      },
    ],
  },
  TVOED_ALLOWANCE: {
    title: "TVöD-Zulage",
    intro:
      "Die allgemeine TVöD-Zulage wird automatisch aus deinem Tarifprofil und Beschäftigungsumfang abgeleitet.",
    items: [
      {
        title: "Vollzeitbetrag",
        text: `${PRODUCT_NAME} berücksichtigt 25 Euro pro Monat bei Vollzeit, für Beschäftigte von Mitgliedern des KAV Baden-Württemberg 35 Euro. Bei Teilzeit wird der Betrag entsprechend der hinterlegten Wochenarbeitszeit anteilig berechnet.`,
      },
      {
        title: "Geltungsbereich",
        text: "Die Zulage wird nur für unterstützte TVöD-P-Tarifprofile und den jeweils gültigen Tarifzeitraum berücksichtigt.",
      },
      {
        title: "Hinweis",
        text: "Dienstvereinbarungen oder abweichende Arbeitgeberregelungen können die tatsächliche Abrechnung verändern.",
      },
    ],
  },
  CARE_ALLOWANCE: {
    title: "Pflegezulage TVöD-P",
    intro:
      "Die Pflegezulage wird aus dem gültigen Tarifstand und deinem Beschäftigungsumfang berechnet.",
    items: [
      {
        title: "Automatische Höhe",
        text: `${PRODUCT_NAME} verwendet den im gewählten Monat gültigen Vollzeitbetrag und rechnet ihn bei Teilzeit proportional zur Wochenarbeitszeit um.`,
      },
      {
        title: "Tarifprofil",
        text: "Die Berechnung setzt ein unterstütztes TVöD-P-Profil mit Gruppe, Stufe und Bereich voraus.",
      },
      {
        title: "Schätzung",
        text: "Der angezeigte Wert dient der Orientierung und ersetzt nicht die individuelle Entgeltabrechnung.",
      },
    ],
  },
  ABOUT: {
    title: `Über ${PRODUCT_NAME}`,
    intro: "Dein Dienstplaner für Schichtarbeit.",
    items: [
      {
        title: "Version",
        text: APP_RUNTIME_LABEL,
      },
      {
        title: "Produktprinzip",
        text: "Dienste einfach planen und Berechnungen nachvollziehen.",
      },
      {
        title: "Hinweis",
        text: `${PRODUCT_NAME} ist eigenständig und nicht mit SuperShift oder einem Tarifpartner verbunden.`,
      },
    ],
  },
};

const TVL_CARE_INFO: InfoContent = {
  title: "Pflegezulage TV-L",
  intro: "Die allgemeine Pflegezulage für Pflegepersonen und Pflegehelfer an Universitätskliniken.",
  items: [
    {
      title: "Automatische Höhe",
      text: "Der im gewählten Monat gültige Vollzeitbetrag wird bei Teilzeit proportional zu deinen Wochenstunden und der tariflichen Vollzeit gerechnet.",
    },
    {
      title: "Grundlage",
      text: "TV-L Entgeltordnung Anlage A, Teil IV, Vorbemerkung Nr. 8 und Anlage F, Abschnitt IV Nr. 8. Besondere Funktions- oder Tätigkeitszulagen werden nicht automatisch angenommen.",
    },
    { title: "Quelle", text: "TdL: https://www.tdl-online.de/tarifvertraege/tv-l" },
    {
      title: "Schätzung",
      text: "Der angezeigte Wert dient der Orientierung und ersetzt nicht die individuelle Entgeltabrechnung.",
    },
  ],
};

const TVUK_CARE_INFO: InfoContent = {
  title: "Pflegezulage TV-UK",
  intro: "200 € bei Vollzeit für Pflege- und Funktionsdienst nach TV-UK.",
  items: [
    {
      title: "Teilzeit",
      text: "Die Zulage wird entsprechend deinen Wochenstunden anteilig berechnet.",
    },
    {
      title: "Berechtigte Gruppen",
      text: "P-UK6 bis P-UK15 einschließlich P-UK9L. Für P-UK5 wird diese Zulage nicht angenommen.",
    },
    {
      title: "Grundlage",
      text: "TV-UK-Entgelt, Anlage D Teil B, Protokollerklärung 1. Besondere Stations- und Tätigkeitszulagen werden nicht automatisch angenommen.",
    },
    { title: "Quelle", text: "AGU: https://agu-uniklinika.de/tarifvertraege/" },
  ],
};

const TVH_CARE_INFO: InfoContent = {
  title: "Pflegezulage TV-H",
  intro: "TV-H: Pflegezulage für KR5 bis KR12, bei Teilzeit anteilig.",
  items: [
    {
      title: "Tarifstand",
      text: "138,04 € ab August 2025, 142,22 € ab Juli 2026 und 146,20 € ab Oktober 2027 bei Vollzeit. Die Auswertung verwendet den zum Monat passenden Betrag.",
    },
    {
      title: "Berechtigte Gruppen",
      text: "KR5 bis KR12. Für KR13 bis KR16 wird diese Pflegezulage nicht angenommen.",
    },
    {
      title: "Grundlage",
      text: "TV-H §43 Nr. 5a und Tarifeinigung vom 27.03.2026. Besondere Stations- und Tätigkeitszulagen werden nicht automatisch angenommen.",
    },
    {
      title: "Quelle",
      text: "Land Hessen: https://innen.hessen.de/buerger-staat/arbeits-und-dienstrecht/oeffentliches-dienst-und-arbeitsrecht/entgelt",
    },
  ],
};

export function SettingsInfoDetailsScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ section?: RouteParam; tariff?: RouteParam }>();
  const parsedSection = parseEnumRouteParam(params.section, [
    "STORAGE",
    "CALCULATION",
    "ABOUT",
    "TVOED_ALLOWANCE",
    "CARE_ALLOWANCE",
  ] as const);
  const parsedTariff = parseEnumRouteParam(params.tariff, ["TVL", "TVUK", "TVH"] as const);
  if (parsedSection.status !== "valid" || parsedTariff.status === "invalid") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zur Information enthält einen unbekannten Bereich."
        onRetry={() => router.back()}
        title="Information kann nicht geöffnet werden"
      />
    );
  }
  const section: SettingsInfoSection = parsedSection.value;
  const content =
    section === "CARE_ALLOWANCE" && parsedTariff.status === "valid"
      ? parsedTariff.value === "TVH"
        ? TVH_CARE_INFO
        : parsedTariff.value === "TVUK"
          ? TVUK_CARE_INFO
          : TVL_CARE_INFO
      : INFO_CONTENT[section];

  return (
    <BackFooterLayout
      onPress={() => router.back()}
      style={{ backgroundColor: palette.groupedBackground }}
    >
      {(bottomPadding) => (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={{ backgroundColor: palette.groupedBackground }}
          contentContainerStyle={{
            flexGrow: 1,
            gap: 14,
            padding: 16,
            paddingBottom: bottomPadding,
          }}
        >
          <Stack.Screen
            options={{
              title: content.title,
              headerStyle: { backgroundColor: palette.background },
              headerTintColor: palette.text,
              headerTitleStyle: { color: palette.text },
              statusBarStyle: palette.dark ? "light" : "dark",
            }}
          />
          <Text
            selectable
            style={{
              color: palette.textSecondary,
              fontFamily: INTER_FONTS.regular,
              fontSize: TYPOGRAPHY.small.fontSize,
              lineHeight: TYPOGRAPHY.compact.lineHeight,
            }}
          >
            {content.intro}
          </Text>
          <SurfaceCard>
            {content.items.map((item, index) => (
              <View
                key={item.title}
                style={{
                  gap: 4,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: palette.separator,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontFamily: INTER_FONTS.semibold,
                    fontSize: TYPOGRAPHY.compact.fontSize,
                    fontWeight: "600",
                  }}
                >
                  {item.title}
                </Text>
                <Text
                  selectable
                  style={{
                    color: palette.textMuted,
                    fontFamily: INTER_FONTS.regular,
                    fontSize: TYPOGRAPHY.caption.fontSize,
                    lineHeight: TYPOGRAPHY.label.lineHeight,
                  }}
                >
                  {item.text}
                </Text>
              </View>
            ))}
          </SurfaceCard>
          <View style={{ flex: 1 }} />
        </ScrollView>
      )}
    </BackFooterLayout>
  );
}
