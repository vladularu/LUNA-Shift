# Gemeinsame Offline-Tarifbasis

Preview und Production verwenden beim Start dieselben vier geprüften Regelpakete aus `rules/releases/preview-generation-6.json`: TVöD VKA BT-K `2026-05-r4`, Arbeitszeitgesetz `2026-01` und Feiertage 2026/2027. Der Tarifträger enthält außerdem die bereits geprüften Tabellen der einfachen Tarifauswahl. Die bisherige Production-Konfiguration bleibt unverändert: kein Remote-Katalog, keine Übernahme gespeicherter Kataloge.

Die eingebetteten Quellen bleiben `REVIEWED`. Ihre kanonischen Inhalte entsprechen dem bereits signiert veröffentlichten Preview-Katalog; nur dessen Veröffentlichungsstatus lautet `PUBLISHED`. Integritätstests prüfen die vier veröffentlichten Hashes nach genau dieser Statusumstellung. Das Einbetten erteilt keine neue fachliche Freigabe für andere Pakete und aktiviert keine Entwürfe.

## Auswahl beim Start

- Ohne verwendbaren gespeicherten Katalog wird die geprüfte App-Basis geladen. Diagnose: `APP_EMBEDDED`, eingebettete Preview-Generation 6. Eine fehlgeschlagene Leseoperation bleibt als Fehler erkennbar.
- Gespeicherte Preview-Generationen bis einschließlich 6 verwenden ebenfalls die App-Basis. Der beobachtete aktive Speicherzeiger bleibt in der Diagnose erhalten; eine lokale Basis wird nicht als gespeicherte Generation ausgegeben.
- Neuere gültige Preview-Kataloge werden weiterhin atomar geladen. Die Signaturprüfung, Vertrauensregeln und Aktivierung im Speicher bleiben unverändert.
- Eine spätere Production-Generation gehört zu einem eigenen Namensraum. Ihre Nummer wird nicht mit der eingebetteten Preview-Generation verglichen. Das ist derzeit nur ein getesteter Laufzeitvertrag; der Production-Remote-Zugang bleibt deaktiviert.
- Ein fehlgeschlagenes Nachladen ersetzt keinen bereits verwendeten gültigen Snapshot. Die lokale Basis allein bestätigt keinen erfolgreichen Download oder Speicherzeiger.

## Historische Zeiträume und Grenzen

Vor Beginn des jeweiligen geprüften Tracks bleibt die bisherige eingebettete Abdeckung erhalten: Tarif vor Mai 2026, Gesetz/Feiertage vor Januar 2026. Diese begrenzte Zuordnung gilt nur für die ausdrücklich kompatiblen Tracks. Herkunft und Paketstatus der historischen Regeln bleiben erhalten.

Unbekannte Tarifauswahl, ungültige Daten, widersprüchliche Pakete und Lücken innerhalb der geprüften Zeiträume bleiben Fehler. Ab April 2027 wird fehlende TVöD-Abdeckung nicht durch ältere Tariftabellen ersetzt. Die Cache-Identität berücksichtigt die geprüften Daten und die historische Auswahlregel, damit abgeleitete Berechnungen nach dem App-Update erneuert werden.

## Juli-Referenz und Abnahme

P8/Stufe 4, BT-K, Region OTHER, 38:30 Wochenstunden: Rufbereitschaftspauschale 24,35 €, Einsatzgrundentgelt 48,70 € plus 13,85 € Überstundenzuschlag; Bereitschaftsdienst mit 450 Minuten und Stufe II ergibt 131,01 € Auszahlung. Die Engine-Tests vergleichen Auszahlung und bewerteten Freizeitausgleich zwischen App-Basis und gespeichertem Katalog.

Der auf dem iPhone bestätigte Dreierfall bleibt bei 17:10 Stunden erfasst. Auszahlung: 8:00 Stunden Zeitkonto und 217,91 € Bereitschaftsvergütung. Bewerteter Freizeitausgleich: 13:37:30 Stunden Zeitkonto und 86,90 €. Die halbe Minute entsteht aus 450 × 75 % = 337,5 Minuten; eine automatische Rundung wird nicht ergänzt.

Der Kalender-Regressionstest setzt Freitag, Samstag und Sonntag ausdrücklich fest und prüft die vorhandenen Wochenend-, Heute- und Auswahlfarben. Die App-Darstellung wird dadurch nicht geändert.

Vor der Übernahme in TestFlight müssen `verify:fast` und `verify:full` bestehen. Die kompatible iOS-Preview wird anschließend auf dem Gerät geprüft, einschließlich erneutem Offline-Start. Veröffentlichung und Geräteabnahme bleiben getrennte Nachweise.
