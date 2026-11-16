#[path = "support/snapshot.rs"]
mod fixture;
use luna_engine::{
    contract::{self, DateRange, SourceFailure, SourceKind, ValidatedRequest},
    runtime::sources::{RequiredCoverage, SnapshotSources, SourceReadError},
};
use serde_json::{Value, json};
fn snapshot(source: Value) -> contract::ImmutableSnapshot {
    let mut value = fixture::raw_snapshot(1, "source-owner", 1);
    value["sources"][0]["source"] = source;
    fixture::seal(&mut value);
    let bytes=serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":value}})).unwrap();
    match contract::parse_request(&bytes).unwrap() {
        ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
        _ => panic!("Expected snapshot"),
    }
}
fn ready(data: Value, coverage: Value) -> Value {
    json!({"state":"READY","revision":3,"coverage":coverage,"payload":{"schemaVersion":1,"data":data}})
}
#[test]
fn raw_source_presence_and_zero_are_retained_without_copying_records() {
    for data in [
        json!({"kind":"MISSING"}),
        json!({"kind":"NULL"}),
        json!({"kind":"VALUE","value":[]}),
        json!({"kind":"VALUE","value":0}),
    ] {
        let snapshot = snapshot(ready(data.clone(), json!({"kind":"ALL_HISTORY"})));
        let sources = SnapshotSources::new(&snapshot);
        let loaded = sources
            .ready(SourceKind::CalendarEntries, RequiredCoverage::AllHistory)
            .unwrap();
        assert_eq!(loaded.revision, 3);
        assert_eq!(serde_json::to_value(loaded.data).unwrap(), data);
        let again = sources
            .ready(SourceKind::CalendarEntries, RequiredCoverage::Any)
            .unwrap();
        assert!(std::ptr::eq(loaded.data, again.data));
        match data["kind"].as_str().unwrap() {
            "MISSING" => assert_eq!(
                loaded.nullable().unwrap_err(),
                SourceReadError::MissingRecord
            ),
            "NULL" => {
                assert!(loaded.nullable().unwrap().is_none());
                assert_eq!(loaded.value().unwrap_err(), SourceReadError::NullRecord);
            }
            _ => assert_eq!(loaded.value().unwrap(), &data["value"]),
        }
    }
}
#[test]
fn loading_read_failures_and_unrequested_sources_never_become_empty_inputs() {
    for (source, error) in [
        (
            json!({"state":"NOT_REQUESTED"}),
            SourceReadError::NotRequested,
        ),
        (json!({"state":"LOADING"}), SourceReadError::Loading),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            SourceReadError::Failed(SourceFailure::ReadFailed),
        ),
    ] {
        let snapshot = snapshot(source);
        assert!(
            matches!(SnapshotSources::new(&snapshot).ready(SourceKind::CalendarEntries,RequiredCoverage::Any),Err(e)if e==error)
        );
    }
}
#[test]
fn adjacent_ranges_cover_a_cross_year_job_but_a_missing_day_or_history_does_not() {
    let requested = DateRange::new("2026-12-01", "2027-01-31").unwrap();
    for (second_start, expected) in [("2027-01-01", true), ("2027-01-02", false)] {
        let coverage = json!({"kind":"DATE_RANGES","ranges":[{"start":"2026-12-01","end":"2026-12-31"},{"start":second_start,"end":"2027-01-31"}]});
        let snapshot = snapshot(ready(json!({"kind":"VALUE","value":[]}), coverage));
        let sources = SnapshotSources::new(&snapshot);
        assert_eq!(
            sources
                .ready(
                    SourceKind::CalendarEntries,
                    RequiredCoverage::Range(&requested)
                )
                .is_ok(),
            expected
        );
        assert!(matches!(
            sources.ready(SourceKind::CalendarEntries, RequiredCoverage::AllHistory),
            Err(SourceReadError::InsufficientCoverage)
        ));
    }
    assert!(DateRange::new("2026-02-31", "2026-03-01").is_err());
    assert!(DateRange::new("2027-01-01", "2026-12-31").is_err());
}
