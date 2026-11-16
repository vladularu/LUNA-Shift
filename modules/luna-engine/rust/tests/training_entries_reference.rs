use bigdecimal::BigDecimal;
use luna_engine::training::{self, PreparedYouthEntries, TrainingError, YouthSource, YouthSpan};
use serde_json::{Value, json};
use std::{str::FromStr, sync::Arc};
/// The observation matrix is test-only composition of the real native helpers;
/// production preparation neither computes four alternative pause policies nor
/// exposes a constructor for host-calculated entry/route tables.
trait ObservedSnapshot {
    fn snapshot(&self) -> Result<Value, TrainingError>;
}
impl ObservedSnapshot for PreparedYouthEntries<'_> {
    fn snapshot(&self) -> Result<Value, TrainingError> {
        let entries = self.entries();
        let work=[0.0,15.0,30.0,60.0].into_iter().map(|minimum_pause|{let spans=entries.iter().map(|e|e.work_spans(minimum_pause)).collect::<Vec<_>>();let all=spans.iter().flatten().cloned().collect::<Vec<_>>();json!({"minimumPause":minimum_pause,"spans":spans.iter().map(|s|s.iter().map(YouthSpan::to_json).collect::<Vec<_>>()).collect::<Vec<_>>(),"unionMinutes":training::union_minutes(&all)})}).collect::<Vec<_>>();
        let travel=entries.iter().map(|e|json!({"school":training::located_school_travel(e,entries).map(|s|s.iter().map(YouthSpan::to_json).collect::<Vec<_>>()),"exam":training::located_exam_travel(e,entries).map(|s|s.iter().map(YouthSpan::to_json).collect::<Vec<_>>()),"activity":training::training_activity_bounds(e,entries).to_json()})).collect::<Vec<_>>();
        let clocks=entries.iter().map(|e|{let zone=self.profile()["timeZone"].as_str().expect("prepared timezone");Ok(json!({"start":training::clock_minutes(e.start_epoch_milliseconds(),zone)?,"end":training::clock_minutes(e.end_epoch_milliseconds(),zone)?,"week":training::week_start(e.shift()["date"].as_str().unwrap())?}))}).collect::<Result<Vec<_>,TrainingError>>()?;
        let all = entries.iter().map(|e| e.bounds()).collect::<Vec<_>>();
        let mut value = self.to_json();
        let out = value.as_object_mut().unwrap();
        out.insert("unionMinutes".into(), json!(training::union_minutes(&all)));
        out.insert("work".into(), json!(work));
        out.insert("travel".into(), json!(travel));
        out.insert("clocks".into(), json!(clocks));
        Ok(value)
    }
}
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|b| same_value(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn raw_entry_intervals_pauses_routes_math_and_all_metadata_match_original_source() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/training-entries-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 94);
    for case in cases {
        let i = &case["input"];
        let source = YouthSource::new(
            i["shifts"].as_array().unwrap().clone().into(),
            i["details"].as_array().unwrap().clone().into(),
            Arc::new(i["profile"].clone()),
        );
        let actual = match source
            .prepare(i["month"].as_str().unwrap())
            .and_then(|p| p.snapshot())
        {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.name(),"message":e.message()}}),
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
fn fixtures() -> Value {
    serde_json::from_str(include_str!("../../reference/training-entries-golden.json")).unwrap()
}
fn case<'a>(fixture: &'a Value, id: &str) -> &'a Value {
    fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
}
fn source(input: &Value) -> YouthSource {
    YouthSource::new(
        input["shifts"].as_array().unwrap().clone().into(),
        input["details"].as_array().unwrap().clone().into(),
        Arc::new(input["profile"].clone()),
    )
}
#[test]
fn neighboring_months_share_actual_prepared_entry_and_source_profile_without_reparsing() {
    let fixture = fixtures();
    let september = case(&fixture, "training-entries-shared-source-overlap-months");
    let october = case(&fixture, "training-entries-shared-source-overlap-october");
    let i = &september["input"];
    let profile = Arc::new(i["profile"].clone());
    let source = YouthSource::new(
        i["shifts"].as_array().unwrap().clone().into(),
        i["details"].as_array().unwrap().clone().into(),
        Arc::clone(&profile),
    );
    assert!(std::ptr::eq(source.profile(), profile.as_ref()));
    assert_eq!(source.stats().entry_preparations, 0);
    assert!(source.prepare("2026-08").unwrap().entries().is_empty());
    assert_eq!(source.stats().entry_preparations, 0);
    let first = source.prepare("2026-09").unwrap();
    let next = source.prepare("2026-10").unwrap();
    assert!(same_value(
        &first.snapshot().unwrap(),
        &september["expected"]
    ));
    assert!(same_value(&next.snapshot().unwrap(), &october["expected"]));
    assert!(std::ptr::eq(first.entries()[0], next.entries()[0]));
    for _ in 0..128 {
        source.prepare("2026-09").unwrap();
        source.prepare("2026-10").unwrap();
    }
    assert_eq!(source.stats().entry_preparations, 1);
}
#[test]
fn cached_uncertainty_is_retained_and_cannot_cross_changed_source_or_timezone() {
    let fixture = fixtures();
    let bad = case(&fixture, "training-entries-invalid-current-version");
    let valid = case(&fixture, "training-entries-work-confirmed-pauses");
    let other_zone = case(&fixture, "training-entries-profile-zone-Etc/UTC");
    let bad_source = source(&bad["input"]);
    for _ in 0..3 {
        let prepared = bad_source.prepare("2026-09").unwrap();
        assert!(prepared.entries().is_empty());
        assert_eq!(prepared.problems().len(), 1);
        assert!(same_value(&prepared.snapshot().unwrap(), &bad["expected"]));
    }
    assert_eq!(bad_source.stats().entry_preparations, 1);
    let fixed = source(&valid["input"]);
    let changed = source(&other_zone["input"]);
    let a = fixed.prepare("2026-09").unwrap();
    let b = changed.prepare("2026-09").unwrap();
    assert!(same_value(&a.snapshot().unwrap(), &valid["expected"]));
    assert!(same_value(&b.snapshot().unwrap(), &other_zone["expected"]));
    assert_ne!(
        a.entries()[0].start_epoch_milliseconds(),
        b.entries()[0].start_epoch_milliseconds()
    );
    assert_eq!(fixed.stats().entry_preparations, 1);
    assert_eq!(changed.stats().entry_preparations, 1);
}
#[test]
fn concurrent_report_requests_initialize_each_native_entry_once() {
    let fixture = fixtures();
    let valid = case(&fixture, "training-entries-work-confirmed-pauses");
    let source = Arc::new(source(&valid["input"]));
    let threads = (0..4)
        .map(|_| {
            let source = Arc::clone(&source);
            std::thread::spawn(move || source.prepare("2026-09").unwrap().snapshot().unwrap())
        })
        .collect::<Vec<_>>();
    for thread in threads {
        assert!(same_value(&thread.join().unwrap(), &valid["expected"]));
    }
    assert_eq!(source.stats().entry_preparations, 1);
}
