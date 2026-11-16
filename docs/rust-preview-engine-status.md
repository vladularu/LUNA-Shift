# Rust-Engine: angenommener Preview-Stand

Stand 16. November 2026. Die Integration uebernimmt die angenommene Bedienung und Oberflaeche unveraendert. React Native/TypeScript verwaltet Navigation, Formulare, lokale Daten, Cloud-Synchronisierung und Darstellung. Rust liefert ueber die bestehende Bruecke fachliche Rechenergebnisse.

## Aktive Preview-Pakete

- Monat: Arbeitszeit, Brutto und Zuschlaege aus Rust.
- Netto und Dienstplanpruefung aus Rust.
- Jahr: Rust-Ergebnisse fuer Arbeitszeit, Netto und Pruefung. Wegen der Antwortgrenze des vorhandenen Build 54 werden zwoelf Rust-Monatsergebnisse fuer das Jahresbrutto voruebergehend in TypeScript zusammengefuehrt.
- Gehaltsvorbereitung mit Jahressonderzahlung und Auszahlungszuordnung aus Rust.
- Gespeicherte Ergebnisse und bestehende Invalidierung bleiben Bestandteil des App-Ablaufs.

Die Preview-Schalter `EXPO_PUBLIC_RUST_MONTH_TRIAL`, `EXPO_PUBLIC_RUST_NET_BRIDGE`, `EXPO_PUBLIC_RUST_ANNUAL_BRIDGE`, `EXPO_PUBLIC_RUST_CHECKS_BRIDGE` und `EXPO_PUBLIC_RUST_SALARY_PREPARATION` waehlen diese Adapter. Production/TestFlight behaelt seinen bisherigen Pfad; ein Git-Merge veroeffentlicht kein App-Update.

## Bewusst verbleibende TypeScript-Pfade

Der funktionierende Berichtsexport mit PDF-Renderer bleibt erhalten, einschliesslich der korrigierten monatlichen Auszahlungszuordnung. Ein vollstaendiger nativer Export und der Ersatz der temporaeren Jahresaggregation brauchen eine spaetere Schnittstellenerweiterung und einen gesondert freigegebenen nativen Build. TypeScript-Referenzberechnungen und der bisherige Production-Pfad bleiben fuer Vergleichstests und Kompatibilitaet verfuegbar. Dieser Stand ist daher kein vollstaendiger Ersatz jedes TypeScript-Rechenpfads.

## Herkunft und Pruefung

Abgenommen auf iPhone Preview Build 54: Update `01a1e47b-6250-7a7e-b2e4-aa75a44f7e07`, Runtime `642bfaefe006b4d4d3114c76973debf29b16036d`, angenommener Source-Digest `baed09e2dcae8e4c96f630ae2c774f3cd99fa2f73f1d4640b71c8078dda85163`. Die Rueckmeldung bestaetigt die angefragten Flows; sie ersetzt keinen kontrollierten Geschwindigkeitsvergleich oder eine Android-Geraeteabnahme.

Fuer die Git-Ablage wurden in `modules/luna-engine/reference/remuneration-allowance-golden.json` ausschliesslich Leerzeichen ausserhalb von JSON-Zeichenketten entfernt. Alle Tokens, Zahlendarstellungen und Vergleichsfaelle bleiben identisch; die Datei unterschreitet dadurch GitHubs 100-MiB-Grenze. Produktcode, Rust-Algorithmen, Berechnungs-Cachevertrag und Native-Build-Identitaet sind davon unberuehrt.

Die Git-Attribute erhalten die exakten Rust-Eingabebytes, da die Engine daraus ihre Build-Identitaet berechnet. Eine automatische CRLF/LF-Konvertierung beim Commit wuerde ansonsten den eingefrorenen Quellvertrag veraendern. Lokale, auf master ignorierte Editor-Einstellungen gehoeren nicht zur Auslieferung.

Reproduzierbare Gates: `npm ci`, `npm run workflow:setup`, `npm run verify:full` und `cargo test --locked --manifest-path modules/luna-engine/rust/Cargo.toml`. Lokale/CI-Exporte sind keine signierten Geraetebuilds. Die Git-Auslieferung umfasst keine EAS-Veroeffentlichung und keine TestFlight-Aenderung.
