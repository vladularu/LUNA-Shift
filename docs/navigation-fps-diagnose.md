# Appweite FPS-Diagnose in der iOS-Preview

Ziel: Den vorhandenen Preview-Stand bei Kalender-, Auswertungs-, Monats- und Unterseitenwechseln gegen 60 FPS / 16,67 ms bewerten. Eine einzige UI-Frame-Probe bleibt oberhalb der Navigation montiert. Keine fachlichen, nativen, Abhängigkeits- oder Animationsänderungen; kein appinternes FPS-Limit.

Unter Mehr die Performancediagnose starten. Die Anzeige nennt UI-Takt, längstes Callbackintervall, Intervalle über 34 ms und die maximale JS-Timerverzögerung im letzten Messfenster. Ausblenden lässt die Messung weiterlaufen; über Mehr lässt sie sich wieder einblenden, stoppen, teilen oder verwerfen. Die Diagnose endet nach zehn Minuten auch außerhalb der Einstellungsseite. Im Hintergrund pausiert der Sampler und beginnt bei Rückkehr ein neues Fenster. Gestoppte Ergebnisse bleiben im RAM für den Export erhalten; Neustart, Verwerfen oder Prozessende entfernen sie.

Der JSON-Bericht enthält Update-ID, Runtime, App-/OS-Version, numerische Messwerte, vollständige 500-ms-Fenster und erlaubte Seitencodes. Unbekannte Routen werden als Weitere Seite erfasst; Parameter, Titel, Gehälter und IDs werden nicht übernommen. Maximal 1200 Fenster und 300 Seitenwechsel. Ein Fenster kann mehrere Seiten überlappen; sein Seitenname ist der Zustand beim Empfang in JS. JS-Empfangszeiten und Routen-Commits sind keine physischen Touch-/Paint-Zeitpunkte. Stale Ergebnisse aus früheren Sitzungen werden verworfen.

Die Messung beschreibt den UI-Callbacktakt, keine tatsächliche GPU-Präsentation. 60 FPS ist ein Vergleichsziel und begrenzt keine höhere gemessene Bildrate. missed60 schätzt verpasste 60-Hz-Gelegenheiten aus den Callbackabständen. Unvollständige Fenster am Ende werden ausgelassen. Messung und Overlay verursachen zusätzliche Last; für Vergleiche dieselben Szenarien mit und ohne Overlay verwenden.

Abnahme auf dem iPhone: zehn Wechsel Kalender/Auswertung, zwanzig Monatswechsel mit Richtungswechseln und zehn Unterseite/Zurück-Wechsel; erster und wiederholter Aufruf getrennt. Durchgängige Werte, kein Abbruch bei Navigation, kein Eingriff in Gesten, korrektes Pausieren im Hintergrund und erfolgreicher Export. Für 60-Hz-Tests auf ProMotion optional die iOS-Option Bildrate beschränken aktivieren. Native Darstellung bleibt bis zum Gerätetest unbestätigt.

Auslieferung: ausschließlich autorisierte iOS-Preview-OTA für Build 54 nach verify:fast, fokussierten Tests, unverändertem Runtime-Fingerprint und frischem Vorgänger-/Quellvergleich. Kein Commit, Push, Native-Build oder TestFlight-Update.
