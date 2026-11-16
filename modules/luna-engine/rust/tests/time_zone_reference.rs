use luna_engine::{EngineError, time_zone};
use serde_json::{Value, json};
#[test]
fn temporal_timezone_identifiers_match_fixed_source_grammar_and_arithmetic() {
    assert_eq!(time_zone::tzdb_version(), Some("2026b"));
    let f: Value =
        serde_json::from_str(include_str!("../../reference/time-zone-golden.json")).unwrap();
    assert_eq!(
        f["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut failures = vec![];
    let (mut accepted, mut rejected) = (0, 0);
    for case in f["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let result = time_zone::zone(name);
        if case["expected"]["rejection"] == "INVALID_TIME_ZONE" {
            rejected += 1;
            if !matches!(result, Err(EngineError::InvalidTimeZone)) {
                failures.push(format!(
                    "{} accepted invalid identifier {:?}",
                    case["id"], name
                ));
            }
            assert_eq!(
                EngineError::InvalidTimeZone.to_string(),
                "Invalid time zone"
            );
            continue;
        }
        accepted += 1;
        let actual=match result{Err(e)=>{failures.push(format!("{} rejected source-valid {:?}: {e}",case["id"],name));continue},Ok(zone)=>Value::Array(case["instants"].as_array().unwrap().iter().map(|ms|{let z=jiff::Timestamp::from_millisecond(ms.as_i64().unwrap()).unwrap().to_zoned(zone.clone());json!({"offsetSeconds":z.offset().seconds(),"year":z.year(),"month":z.month(),"day":z.day(),"hour":z.hour(),"minute":z.minute(),"second":z.second()})}).collect())};
        if actual != case["expected"]["value"] {
            failures.push(format!(
                "{} {:?}\nactual {}\nexpected {}",
                case["id"], name, actual, case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches ({accepted} valid, {rejected} safe rejections)\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Timezone grammar: {accepted} accepted, {rejected} safe rejected");
}
