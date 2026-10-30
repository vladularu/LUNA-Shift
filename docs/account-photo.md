# Eigenes Profilbild

## Auftrag und Auslieferung

Ziel: Im Konto ein eigenes Foto auswählen, ersetzen und entfernen. Das Bild
erscheint auch unter Mehr und wird über die private LUNA Cloud übernommen.
Zielplattform ist das iPhone. Die Umsetzung umfasst zwei Arbeitspakete:

1. Kontogebundene Speicherung und Cloud-Abgleich einschließlich Validierung,
   Kontowechsel-Schutz und Tests.
2. Fotoauswahl, kompakter Profilkopf, Mehr-Karte und Oberflächentests.

Der PR umfasst die 15 Profilbild-Quell- und Testdateien, dieses Dokument sowie
fünf Dateien des notwendigen Sicherheitsfixes in einem separaten Commit.
Kalender- und Rufbereitschaftsfunktionen gehören zu ihren bestehenden PRs.
Native Konfiguration und Paketversionen sind unverändert; die Funktion nutzt
die vorhandenen Expo-SDK-57-Pakete für Fotoauswahl und Bildverarbeitung.
Der ergänzte native Berechtigungstext aus dem früheren Implementierungs-Checkout
bleibt für einen späteren Build zurückgestellt.

Am 29.10.2026 hat der Nutzer nach der vereinfachten Preview-OTA mit
„super commit pr push merge und testflight ota“ die Darstellung und die
Git-/TestFlight-Auslieferung freigegeben. Merge erst nach grüner PR-CI.

## Verhalten

- Das ganze Profilbild ist antippbar; ein kleines Stiftsymbol zeigt die Aktion.
  Name und E-Mail folgen direkt darunter. Während des Speicherns ersetzt ein
  Ladeindikator das Symbol, ohne den Profilkopf zu verschieben.
- Das native iPhone-Menü bietet Foto auswählen, bei vorhandenem Bild Foto
  entfernen und Abbrechen. VoiceOver beschreibt die Fotoaktion.
- Der System-Fotowähler erlaubt einen quadratischen Ausschnitt. Die App
  normalisiert das Ergebnis als JPEG mit maximal 512 × 512 Pixeln und 512 KiB.
- Die verschlüsselte lokale Datenbank speichert das Foto je Konto. Der bestehende
  private Cloud-Abgleich überträgt `presentation.accountPhoto`; eine öffentliche
  Bild-URL oder neue Backend-Tabelle wird nicht benötigt.
- Offline speichern, Abbrechen und Fehler erhalten konsistente lokale Daten.
  Kontowechsel verwerfen laufende Auswahlen und veraltete Menüaktionen.
- `null` überträgt eine Entfernung. Fehlende Felder älterer Cloud-Dokumente
  löschen kein vorhandenes Foto; der Drei-Wege-Abgleich behandelt sie als
  unveränderten Basisstand. Unterschiedliche Änderungen nutzen die vorhandene
  Konfliktauswahl.
- Allgemeine JSON-Backups enthalten keine kontogebundenen Fotodaten.

## Preview-Nachweise

Die erste Profilbild-OTA wurde als Gruppe
`72b3c215-578b-49c0-ba8e-1b650f365569` veröffentlicht. Der Screenshot um
19:49 Uhr am 29.10.2026 zeigte das ausgewählte Foto und führte zum Auftrag,
die dauerhaften Textzeilen durch die kompakte Bedienung zu ersetzen.

Die vereinfachte Bedienung wurde anschließend als Preview-Gruppe
`8479558c-deda-4817-9612-5e171d7d5690` veröffentlicht, iOS-Update
`01a18926-a877-709b-b064-1f485e5add85`. Runtime für Preview Build 44:
`b99c3cf0dd56e6b1bb126d195f21c665de57760b`.

Der kombinierte Preview-Stand bestand `verify:fast` mit 9.987 Fachtests und
1.579 Oberflächentests. Export, Manifest und CDN-Bundle stimmten überein:
SHA-256 `5598cc5d997816e326ceb3053786d1785bcee74c19df39cf6ef0c6d1d23fd0c0`.
Alle 53 Manifest-Assets passten; 2.235 eingefrorene Quelldateien blieben während
der Auslieferung unverändert. Die dafür übernommenen Rufbereitschaftsänderungen
sind kein Bestandteil dieses Profilbild-PRs.

Die TestFlight-Auslieferung erhält den aktuellen Beta-Stand und benötigt einen
passenden Production-Fingerprint. Die tatsächliche Übernahme auf dem iPhone
sowie Entfernen und Cloud-Abgleich auf einem zweiten Gerät werden gesondert
bestätigt; Metadaten und Bundle-Hashes ersetzen diese Geräteprüfung nicht.

## Voraussetzung für die Auslieferung

Das Produktionsaudit des aktuellen Master-Stands blockierte wegen
[CVE-2026-118664](https://github.com/advisories/GHSA-qr28-fpjm-wq7f).
Der bereits in Preview geprüfte Sicherheitsfix aus `356748f` wird deshalb als
separater Commit übernommen: fünf Decoder-/Audit-Dateien, einschließlich
Regressionstests und überprüfter Patch-Hashes. Er begrenzt die Verarbeitung
vieler unterschiedlicher Prozentkodierungen in Expo-Deep-Links und erweitert
die bestehende Härtung, ohne Paketversionen oder native Konfiguration zu ändern.

## Prüfung des Release-Stands

Der isolierte Release-Branch bestand `verify:fast` mit 9.915
Fachtests, 1.574 Oberflächentests in 167 Suiten und allen
weiteren Prüfskripten. Gezielt bestanden 11 Daten-/Cloud-Tests und 24
Oberflächentests; das Produktionsaudit ist nach dem separaten Sicherheitsfix grün.
Alle 1.854 bisherigen Beta-Dateien außerhalb des freigegebenen Änderungsumfangs
stimmen mit der bisherigen Production-Auslieferung überein. Die konkreten
PR-, Merge- und TestFlight-OTA-Nachweise werden in der PR-Beschreibung ergänzt.
