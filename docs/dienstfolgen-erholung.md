# Dienstfolgen & Erholung

Die bisherige Bezeichnung „Planungshinweise“ wird in Einstellungen, Monats-/Jahresauswertung, Prüfungsdetails und Berichten durch „Dienstfolgen & Erholung“ ersetzt. Der Untertitel lautet „Hinweise zu Nachtserien, Dienstwechseln und Erholungszeiten.“

## Darstellung

- Übersicht und Prüfungseinstellungen verwenden reguläre, neutrale Karten.
- Nur tatsächliche Hinweiskarten haben einen petrolfarbenen Rahmen: `#2E7D87` im Hellmodus und `#6AB7C2` im Dunkelmodus. Flächen und Texte bleiben neutral.
- Die Kategorie „Arbeitswissenschaftliche Hinweise“ ergänzt die Farbunterscheidung.
- Dienstfolgen zeigen ein neutrales Info-Symbol. Die Übersicht zählt „1 Hinweis“ beziehungsweise „2 Hinweise“; VoiceOver verwendet dieselbe Einordnung.
- Gesetzliche Prüfungen behalten ihre Warn-/Kritisch-Symbole und Schweregradtexte.
- Ausgeschaltete Dienstfolgen-Hinweise erzeugen keine zusätzliche Ausblend-Hinweiskarte.

## Scope und Arbeitspakete

Zielplattform ist die bestehende iOS-Preview auf dem iPhone. Die Umsetzung umfasst zwei getrennte Arbeitspakete: durchgängige Benennung einschließlich Berichten sowie die Darstellung und Kennzeichnung der Karten. Die Ausblend-Hinweiskarte wird in Monats-/Jahresansichten und beiden Detaildarstellungen entfernt.

Der Scope umfasst die zugehörigen Darstellungsdateien unter `src/features/analysis/`, Prüfungseinstellungen, Berichtstexte, den additiven Palette-Wert `planningBorder`, bestehende Komponententests und die genaue Quellzuordnung unter `releases/testflight/`.

Es gibt keine Änderungen an Prüfregeln oder Schwellen, internen Schweregraden, gespeicherten Einstellungen, Gehaltsberechnungen oder nativer Integration. Die zuvor recherchierte fachliche Erweiterung der Regeln ist nicht Bestandteil dieser Darstellungskorrektur.

## iPhone-Abnahme

Der Nutzer hat die finale Preview am 07.11.2026 mit „passt so Commit und GitHub-Abgleich“ abgenommen und die Git-Übernahme freigegeben.

- App: LUNA Shift Internal, Preview Build 49.
- Update-Gruppe: `a28e6587-9ff8-4833-95cd-0e2f3171f62b`.
- Update: `01a1b479-f2bc-7c8e-8b48-cf354f7123a7`.
- Runtime: `402e757d98ca799660ce5dd15a24bd999cf690eb`.
- Abgenommener Preview-Quellstand: `7a307f71208442af1b30d6ddac6f658b67cb82aa6171ea5724afbf7c59b3c9f3`.
- Ausgeliefertes Bundle: `89ba04018aad0bb5f6a31e7b90598491deb83549c5c94cd85011f2c2f82d70ab`; Bundle und alle 34 Assets wurden gegen den geprüften Export verifiziert.
- Zustände: neutraler Überblick und Einstellungen, tatsächliche Hinweise mit petrolfarbenem Rahmen, Info-Symbol und Hinweiszählung. Hell-/Dunkelansichten wurden während der Iteration auf dem iPhone geprüft.
- Genaues iPhone-Modell und iOS-Version wurden nicht erfasst. Android wurde nicht auf einem Gerät abgenommen.

Die Git-Übernahme setzt auf dem aktuellen `master` auf. Unabhängige Luftig-Anpassungen der Preview sind nicht Teil dieses Changesets. Elf vollständige Feature-Dateien und die drei betroffenen Dashboard-Deklarationen wurden mit dem abgenommenen Preview-Stand verglichen; die vorhandene Gehaltskarten-Geometrie des `master` bleibt erhalten. Der Git-Quellstand ist daher nicht mit dem gesamten unabhängigen Preview-Theme gleichzusetzen.

## Validierung

Die abgenommene Preview bestand `verify:fast` mit 10.450 Unit-Tests und 1.912 Komponententests sowie 31 fokussierte Tests. Die fokussierten Tests prüfen das tatsächliche Info-Symbol, unveränderte gesetzliche Warnanzeigen, Sichtbarkeit, neutrale Flächen/Texte und Kontrast bei Hell/Dunkel sowie großer Schrift.

Der isolierte Lieferbranch besteht `verify:fast` vollständig mit 10.450 Unit-Tests und 1.912 Komponententests. Der TestFlight-Quellvergleich ist bestanden. Die vollständige Pull-Request-CI wird vor dem Merge abgewartet. TestFlight-/Production-Veröffentlichungen sind separat freizugeben.
