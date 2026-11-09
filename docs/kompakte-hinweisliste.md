# Kompakte Hinweise im bestehenden LUNA-Design

## Freigegebener Auftrag

Die ausgewählte Variante „Kompakte Liste“ wird lokal umgesetzt. Empfehlungen erscheinen als antippbare Einzelzeilen in einer bestehenden neutralen LUNA-Karte je Datumsgruppe. Die dauerhafte Wochenendstatistik und der allgemeine Link zur Wochenendübersicht entfallen aus Auswertung und Prüfansichten. Je Nachtserie erscheint höchstens ein Erholungshinweis. Die sichtbaren Empfehlungen zu 24 bzw. 48 Stunden schließen sich aus.

Ausgangspunkt ist die veröffentlichte iOS-Preview cc463d68-5b0a-4b2d-96cd-078d772c0d31, Update 01a1be6c-11b7-7da9-8b26-f020b51cc8fe, Source-Digest df0fba0733dde5e2739401995d6260afff50ec6d3c85ab49bb6b5f3dad5ad3cf. Alle 108 vorher geänderten Dateien und die vollständige Laufzeitinventur sind unter artifacts/kompakte-hinweisliste/before.json und before/ gesichert.

HEAD: 7025cc840eb6f712cdef4476c02a93ddcca53e70. Arbeitsbranch: codex/kompakte-hinweisliste. Installiertes Expo: ~57.0.31. Die passende SDK-57-Dokumentation wurde vor Codeänderungen gelesen. Ziel ist das iPhone mit Hell-/Dunkelmodus, großer Schrift und VoiceOver.

## Grenzen

Bestehende LUNA-Schriftgrößen, Abstände, Rundungen, Datumsspalte, Navigation, neutrale Empfehlungen sowie blaue Tarif- und warme Gesetzesrahmen bilden die visuelle Referenz.

Die fachlichen Auslöser bleiben unverändert: Nachtserien ab vier Nächten, Erholungsprüfung ab zwei Nächten mit 24/48 Stunden, Wochenendempfehlung bei weniger als zwei vollständig freien Wochenenden in einem vollständig beurteilbaren Vierwochenzeitraum. Fehlende Daten bleiben offen. Gesetz und Tarif bleiben getrennt geprüft.

Keine Änderungen an Dienstdaten, Profilen, Cache-/Datenbankschema, Gehalt, Zuschlägen, Sollzeit, signierten Regelpaketen, nativer Konfiguration oder Abhängigkeiten. Keine neuen globalen UI-Tokens, Farben oder Schalter.

Nur lokale Implementierung und Verifikation sind freigegeben. Commit, Push, PR/Merge, OTA, EAS Build, TestFlight und Store benötigen eigene Freigaben. Veröffentlichungsnachweise, das vorherige Quellarchiv und die abgenommene TestFlight-Baseline werden nicht überschrieben.

## Arbeitspakete

1. **A – Liste und beide Prüfrenderer, höchstens 15 Dateien.** Eigentümer dienstplan_check_cards: neue planning-hint-list.tsx mit sinnvollem Komponententest; compliance-issue-content.tsx mit optionaler kompakter Planungssicht unter Wiederverwendung des vorhandenen Detailsheets; compliance-day-list.tsx, compliance-details.tsx und zugehörige bestehende Renderer-/Gruppentests. Keine Bearbeitung von Presenter, Wochenendhelper oder Dashboard.
2. **B – Texte und Details, höchstens 15 Dateien.** Eigentümer dienstplan_check_groups: planning-hint-presentation.ts und Test, planning-hint-details.tsx mit eigenem sinnvollem Renderer-Test, weekend-assessment-summary.tsx und Test für auf auffällige Fenster begrenzte Details sowie check-presentation.ts und dessen Test für denselben eindeutigen 24/48-Fallbacktext. Keine Bearbeitung der Haupt-Prüfrenderer oder des Dashboards.
3. **C – Auswertung, höchstens 15 Dateien.** Eigentümer dienstplan_check_plan: dashboard-cards.tsx, dashboard-loading.component.test.tsx, analysis-overview-cards.component.test.tsx, empty-month.component.test.tsx. Den permanenten Statistikblock entfernen, den bestehenden eingeschränkten Prüfstatus und dessen Metadaten beibehalten.
4. **D – Integration und Quellenschutz, höchstens 15 Dateien.** Eigentümer Root: dieses Dokument, exakte erlaubte Änderungen in build-9.reviewed-changes.json, gegebenenfalls notwendige bestehende Integrationsregressionen, Aufgabenartefakte und abschließende Gates.

Weitere Dateien werden vor Bearbeitung abgestimmt. Kein Paket bearbeitet Dateien eines anderen Pakets.

## Gemeinsamer Darstellungsvertrag

PlanningHintPresentation darf optionale compactTitle und compactSummary als Strings erhalten. Der bereits vorhandene optionale weekendPeriod benennt den ausgewählten tatsächlich auffälligen Zeitraum mit inklusiven from/until-Daten. Alte oder ungeprüfte Facts behalten sichere bestehende Fallbacks. Aus unvollständigen Einträgen werden keine Zeiträume erfunden.

Eine neutrale Karte pro Datum enthält die notwendigen Planungszeilen mit mindestens 44 Punkten Höhe, Umbruch, Chevron und zugänglichem Namen. Jede Zeile öffnet das vorhandene Detailsheet für ihren Prüfpunkt. Gesetzliche und tarifliche Karten behalten ihre bisherige Darstellung.

Arbeitsserie und Nachtserie bleiben unterscheidbare Prüfpunkte. Erholungsaussagen derselben nachgewiesenen Nachtphase werden einmal dargestellt. Nur sicher identifizierte Duplikate dürfen zusammengeführt werden; unbekannte oder widersprüchliche Beobachtungen bleiben sichtbar. Die Engine liefert pro Nachtphase bereits einen Nacht-/Erholungsbefund, benötigt also keine neue Regel.

- Unter 24 Stunden nennt die sichtbare Erholungsempfehlung ausschließlich mindestens 24 Stunden.
- Ab 24 bis unter 48 Stunden nennt sie ausschließlich möglichst 48 Stunden. Bei 47:30 Stunden wird die Differenz von 30 Minuten verständlich.
- Ab 48 Stunden erscheint keine zusätzliche Erholungsempfehlung. Ein weiterhin notwendiger Hinweis auf die Länge einer Nachtserie bleibt erhalten.

Details enthalten Beobachtung, Empfehlung, zugehörige Dienste und Quelle jeweils einmal. Strukturierte Daten werden nicht zusätzlich unter „Weitere Angaben“ mit demselben Originaltext wiederholt. Dienste bleiben anfangs eingeklappt. Wochenenddetails zeigen nur vollständig beurteilbare auffällige Vierwochenfenster, keine allgemeine Monatsübersicht und keine Liste erfüllter Zeiträume.

Der Export weekendAssessmentOpen bleibt verfügbar, solange Übersicht oder Prüfansichten ihn für den eingeschränkten Status verwenden. Das interne Berechnungsmodell bleibt erhalten; seine Existenz rechtfertigt keinen permanenten Statistikrenderer.

## Abnahme

- Im Oktoberbeispiel erscheinen drei einzeln antippbare Planungszeilen: sieben Diensttage, einmal Erholung nach drei Nächten, ein Wochenendbefund mit 07.09.–04.10.
- Auswertung und beide Prüfrenderer zeigen keine permanenten Wochenendzahlen und keinen allgemeinen Übersichtslink, auch bei leeren Monaten, ausgeschalteten Empfehlungen oder fehlenden Befunden.
- Erholung unter 24, ab 24 bis unter 48, genau 48 und nach langen Nachtserien ist sinnvoll abgesichert. Gleiche nachgewiesene Nachtphase wird nicht doppelt dargestellt, widersprüchliche Beobachtungen verschwinden nicht.
- Alle notwendigen Quellen und Dienste bleiben erreichbar. Unauffällige Wochenendfenster erscheinen nicht in der Hinweisliste.
- Empfehlungen-Schalter, eingeschränkter Prüfstatus, gesetzliche/tarifliche Darstellung und bisherige Daten-/Berechnungsfälle bleiben abgedeckt.
- Gezielte RED/GREEN-Regressionen, unabhängige Reviews, npm.cmd run verify:fast, lokaler iOS-Export und exakter Quellenvergleich sind erforderlich.
- Die reale iPhone-Abnahme und eine spätere Preview-OTA stehen als getrennte Schritte aus.

## Ergebnis der lokalen Umsetzung

Die kompakte Liste ist in beiden Prüfansichten umgesetzt. Die Auswertung enthält keine dauerhafte Wochenendstatistik mehr. Jede notwendige Empfehlung öffnet ihre Details einzeln; Dienste bleiben zunächst eingeklappt. Je nachgewiesener Nachtphase wird nur eine Erholungsaussage dargestellt. Die sichtbaren Empfehlungen zu 24 und 48 Stunden schließen sich aus. Die bestehenden fachlichen Auslöser sowie gesetzliche und tarifliche Karten bleiben erhalten.

Der Aufgabenumfang umfasst 22 Dateien, davon neun Laufzeitdateien. Unabhängige Reviews haben keine offenen Befunde. `npm.cmd run verify:fast` ist vollständig grün: 10.740 Vitest-Tests in 563 Dateien und 1.999 Jest-Komponententests in 208 Suites sowie die weiteren Prüfungen des Skripts. Der lokale iOS-Export ist erfolgreich. Zwei zunächst aufgefallene TypeScript-Typangaben in Testtabellen wurden korrigiert, ohne Fälle oder Assertions zu ändern; das ursprüngliche Fehlerprotokoll bleibt erhalten.

Der abschließende Quellenvergleich sichert 91 unabhängige vorherige Änderungen unverändert, begrenzt die Laufzeitänderungen auf die neun vereinbarten UI-Dateien und bewahrt die abgenommene TestFlight-Baseline sowie das veröffentlichte Vorgängerarchiv. Source-Digest: `f4af756a61ca9eff9a9bccf6f71344d8641fbc5cf84841766c7e9450b0a11055`. Die Nachweise liegen unter `artifacts/kompakte-hinweisliste/result.json` und den dort referenzierten Protokollen.

Es wurden kein Commit, Push, OTA und kein nativer Build ausgeführt. Die reale Abnahme auf dem iPhone steht aus; lokale Tests und Export ersetzen sie nicht.
