mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    calendar::window::CalendarRecordSource, report::time::TimeReportContext, rules::RuleResolver,
    target::PreparedTargetSource,
};
use serde_json::{Value, json};
use std::sync::Arc;

fn resolver(input: &Value) -> Arc<RuleResolver> {
    if let Some(raw) = input.get("resolver") {
        Arc::new(
            RuleResolver::from_catalog_json(
                raw["catalog"].clone(),
                serde_json::from_value(raw["packageIds"].clone()).unwrap(),
                raw.get("historical")
                    .filter(|v| !v.is_null())
                    .map(|v| serde_json::from_value(v.clone()).unwrap()),
            )
            .unwrap()
            .with_collation_ranks(serde_json::from_value(raw["collationRanks"].clone()).unwrap()),
        )
    } else {
        Arc::new(RuleResolver::bundled().unwrap())
    }
}

#[test]
fn borrowed_record_owner_matches_unchanged_original_month_kernel_outputs() {
    // These are the unchanged declared math inputs of the original reference,
    // not a Host Ready-profile admission or a selected-Provider lifecycle proof.
    let data = value_pool::decode(include_str!("../../reference/monthly-time-golden.json"));
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let profile = Arc::new(input["profile"].clone());
        let source = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
        let entries: Arc<Vec<Arc<Value>>> = Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect(),
        );
        let result = TimeReportContext::with_record_source(
            profile,
            source,
            entries,
            resolver(input),
            Arc::new(serde_json::from_value(input["collationRanks"].clone()).unwrap()),
        )
        .and_then(|mut context| context.month_shared(input["month"].as_str().unwrap()));
        let actual = match result {
            Ok(value) => json!({"value":value.as_ref()}),
            Err(error) => {
                json!({"error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

struct Fields {
    entries: Arc<Vec<Arc<Value>>>,
    fields: Vec<Value>,
}
impl CalendarRecordSource for Fields {
    fn entries_len(&self) -> usize {
        self.entries.len()
    }
    fn base_value(&self, index: usize) -> &Value {
        self.entries[index].as_ref()
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        self.fields[index]
            .get(key)
            .or_else(|| self.base_value(index).get(key))
    }
}

#[test]
fn effective_appearance_and_original_physical_allocations_match_original_without_a_value_tree() {
    let data = value_pool::decode(include_str!(
        "../../reference/time-record-fields-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 116);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let profile = Arc::new(input["profile"].clone());
        let prepared = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
        let source = Fields {
            entries: Arc::new(
                input["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .cloned()
                    .map(Arc::new)
                    .collect(),
            ),
            fields: input["recordFields"].as_array().unwrap().clone(),
        };
        let result = TimeReportContext::with_record_source(
            profile,
            prepared,
            source,
            resolver(input),
            Arc::new(serde_json::from_value(input["collationRanks"].clone()).unwrap()),
        )
        .and_then(|mut context| context.month_shared(input["month"].as_str().unwrap()));
        let actual = match result {
            Ok(value) => json!({"value":value.as_ref()}),
            Err(error) => {
                json!({"error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn borrowed_owner_annual_outputs_match_all_unchanged_original_annual_cases() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-time-golden.json")).unwrap();
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let profile = Arc::new(input["profile"].clone());
        let source = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
        let entries: Arc<Vec<Arc<Value>>> = Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect(),
        );
        let result = TimeReportContext::with_record_source(
            profile,
            source,
            entries,
            resolver(input),
            Arc::new(serde_json::from_value(input["collationRanks"].clone()).unwrap()),
        )
        .and_then(|mut c| c.annual(input["year"].as_i64().unwrap() as i32));
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn daily_borrowed_allocations_retain_the_exact_physical_record_and_compatibility_bytes() {
    use luna_engine::{
        calendar::recurrence::CollationRanks,
        credit::{
            daily::{self, DailyCreditContext},
            prepared::PreparedCreditEntries,
        },
    };
    use std::collections::BTreeMap;
    let entry = json!({"kind":"SHIFT","id":"work","date":"2026-11-02","type":"CUSTOM","title":"physical","color":"#112233","symbol":"W","deletedAt":null,"startTime":"08:00","endTime":"16:00","breakMinutes":30});
    let prepared = PreparedCreditEntries::from_refs(vec![&entry]).unwrap();
    let ranks: CollationRanks = BTreeMap::from([("work".into(), 0)]).into();
    let context = DailyCreditContext {
        target_minutes: 480.into(),
        absence_reference_minutes: 480.into(),
    };
    let borrowed = daily::calculate_daily_work_credit_borrowed_prepared(
        "2026-11-02",
        &prepared,
        "Europe/Berlin",
        &context,
        &ranks,
    )
    .unwrap();
    let owned = daily::calculate_daily_work_credit_prepared(
        "2026-11-02",
        &prepared,
        "Europe/Berlin",
        &context,
        &ranks,
    )
    .unwrap();
    assert!(std::ptr::eq(borrowed.allocations[0].entry, &entry));
    assert_eq!(
        borrowed.allocations[0].minutes,
        owned.allocations[0].minutes
    );
    assert_eq!(borrowed.allocations[0].entry, &owned.allocations[0].entry);
    assert_eq!(
        borrowed.summary.actual_minutes,
        owned.summary.actual_minutes
    );
}

#[test]
fn fifty_thousand_record_handles_are_retained_once_and_released_with_the_last_output() {
    use luna_engine::report::records::ReportRecords;
    // Memory/ownership guard only: shared immutable out-of-month rows are not a
    // SQL ID uniqueness or locale parity fixture. No full Value plan is built.
    let record = Arc::new(
        json!({"kind":"APPOINTMENT","id":"outside","date":"2026-12-01","deletedAt":null,"opaque":"x".repeat(32*1024)}),
    );
    let entries = Arc::new(vec![record; 50_000]);
    let weak = Arc::downgrade(&entries);
    let owner = ReportRecords::new(Arc::clone(&entries));
    assert_eq!(owner.entries_len(), 50_000);
    assert!(std::ptr::eq(owner.base_value(0), entries[0].as_ref()));
    assert!(std::ptr::eq(
        owner.base_value(49_999),
        entries[49_999].as_ref()
    ));
    let profile = Arc::new(
        json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200}),
    );
    let prepared = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
    let mut context = TimeReportContext::with_record_source(
        profile,
        prepared,
        owner,
        Arc::new(RuleResolver::bundled().unwrap()),
        Arc::new(Default::default()),
    )
    .unwrap();
    let result = context.month_shared("2026-11").unwrap();
    assert!(Arc::ptr_eq(
        &result,
        &context.month_shared("2026-11").unwrap()
    ));
    drop(entries);
    drop(context);
    assert!(weak.upgrade().is_some());
    drop(result);
    assert!(weak.upgrade().is_none());
}
