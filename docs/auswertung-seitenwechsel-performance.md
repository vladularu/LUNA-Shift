# Auswertung: Seitenzustand bei Wechseln erhalten

## Auftrag und Umfang

Ziel: Vermeidbaren Neuaufbau der bereits vorbereiteten Auswertungsseite entfernen, damit weniger Arbeit mit einem Seitenwechsel zusammenfällt. Zielplattform ist die iOS-Preview mit Expo SDK 57 und der bestehenden Build-54-Runtime.

Dateiscope: `src/ui/report-period-pager.tsx`, `src/features/analysis/analysis-screen.tsx`, Pager- und Analysis-Rule-Coverage-Komponententests, dieses Dokument und die zwei exakten Quellhashes im bestehenden TestFlight-Abgleich. Ausgangspunkt ist der unveränderte veröffentlichte Diagnosestand vom 17.11.2026 auf `master` 1d1b6ca8. Die zwölf uncommitteten Diagnosedateien werden separat unverändert übernommen; sie gehören nicht zur neuen Optimierung.

Nicht-Ziele: Rechenregeln, Rust-Bridge, Datenbank, Cache-Identität, Gestaltung, native Konfiguration oder ein künstliches Bildratenlimit. Diese lokale Implementierung enthält keine neue OTA-, Git- oder TestFlight-Veröffentlichung.

## Nachweis und Änderung

Die gelieferte Diagnose stammt von Preview-Update `01a1e9ee-482e-76fb-84d8-98f82be885cb`. In rund 80 Sekunden enthält sie 63 UI-Callbackintervalle über 34 ms, davon 44 über 50 ms; das längste beträgt 133,44 ms. Die größte erfasste JS-Timerverzögerung beträgt 427,46 ms. Der Durchschnitt von rund 112 UI-Callbacks pro Sekunde verdeckt diese einzelnen Aussetzer. Diese Probe misst Callbacktakt, keine GPU-Präsentation, und beweist allein keine bestimmte verursachende Funktion.

Im Code nachgewiesen und vor der Korrektur durch drei fehlschlagende Regressionstests reproduziert:

- Die erste Größenmessung ersetzt die direkte Einzelansicht durch einen ScrollView und baut die ausgewählte Vorbereitung erneut auf: zwei statt einem Aufbau.
- Ein Monat/Jahr-Wechsel ersetzt den Pager durch `key={period}`. Auch der innere ScrollView besitzt einen von Zeitraum und Anker abhängigen Schlüssel. Beim Wechsel außerhalb des ursprünglichen Ankers verliert die ausgewählte Seite zusätzlich ihre Position im Baum.
- Das Verschieben des Seitenfensters ersetzt den ScrollView durch den neuen Anker-Schlüssel: zwei statt einem Aufbau der schon sichtbaren Zielseite.

Der Pager behält deshalb denselben ScrollView und dieselben nach Monat geschlüsselten Seiten. Vor dem ersten Layout wird nur die ausgewählte Seite vorbereitet. Beim Einheitwechsel enthält das neue Fenster sofort den ausgewählten Monat; das native Scrollziel wird ohne Zusatzanimation neu positioniert. Veraltete Scrollhandler und verspätete Endpositionen dürfen keinen anderen Zeitraum auswählen. Nachbarseiten bleiben wie bisher begrenzt vorbereitet. Der äußere erzwungene Neuaufbau beim Monat/Jahr-Wechsel entfällt.

Die Tests prüfen erhaltenen Vorbereitungszustand beim ersten Layout, bei Monat/Jahr-Wechseln außerhalb des Ankers, nach Jahresnavigation und beim Verschieben des Fensters. Bestehende Fälle decken schnelle Pfeilfolgen, Richtungswechsel, Today, Breitenänderung, reduzierte Bewegung, sichtbare Platzhalter und verborgene Seiten ab. Erhaltener Zustand belegt weniger Neuaufbau, keine bestimmte FPS-Steigerung.

## Abnahme auf dem iPhone

Vor Veröffentlichung: `npm.cmd run verify:fast`, fokussierte Navigation-/Vorbereitungsprüfungen und ein iOS-Export mit der produktiven Compiler-/Worklet-Transformation.

Nach separat freigegebener Preview-OTA denselben Ablauf auf demselben iPhone wiederholen: zehn Wechsel Kalender/Auswertung, zwanzig Monatswechsel mit Richtungswechseln, zehn Monat/Jahr-Wechsel einschließlich eines verschobenen Jahres und zehn Unterseite/Zurück-Wechsel. Kaltstart und wiederholten Aufruf getrennt prüfen. Diagnoseeinstellungen, Overlay-Sichtbarkeit und iOS-Bildratenoption beibehalten.

Zu vergleichen sind Anzahl und Rate der Intervalle über 34/50 ms, längstes Intervall und JS-Verzögerungen; der FPS-Durchschnitt allein genügt nicht. Sichtprüfung: korrekter Monat/Jahr, durchgängige Werte ohne neu ausgelösten Ladezustand einer erhaltenen fertigen Seite, keine Sprünge beim Verschieben des Fensters und flüssige Richtungswechsel. Video und JSON müssen die neue Update-ID nennen. Neue Daten oder bisher unvorbereitete Zeiträume können weiterhin echte Vorbereitung benötigen.

Geräteabnahme und Verbesserung der tatsächlichen Framezeiten sind bis zu diesem Vergleich offen. Eine Garantie für aussetzerfreie Darstellung auf jedem Gerät lässt sich aus Quellcode oder Komponententests nicht ableiten. Falls die Messung weiterhin deutliche Aussetzer zeigt, wird der verbleibende Pfad anhand des neuen Berichts eingegrenzt.
