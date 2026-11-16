#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::incoming::visible::{PreparedIncomingCalendars, VisibilityContext};
use luna_engine::calendar::{
    recurrence::CollationRanks,
    widget::{WidgetClock, WidgetRowOptions},
};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn captured_visibility_is_a_native_source_not_current_unfiltered_cache() {
    let source = value_pool::decode(include_str!("../../reference/widget-selected-golden.json"));
    let cases = source["cases"].as_array().unwrap();
    let locale: Value =
        serde_json::from_str(include_str!("../../reference/widget-selected-ranks.json")).unwrap();
    assert_eq!(cases.len(), 72);
    let dump_path = std::env::var("LUNA_WIDGET_SELECTED_NATIVE_OUTPUT").ok();
    let mut dumped = Vec::new();
    let mut frames = 0;
    for c in cases {
        let i = &c["input"];
        let ctx = &i["context"];
        let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
        let prepared = PreparedIncomingCalendars::prepare(
            Arc::new(i["calendars"].as_array().unwrap().clone()),
            &VisibilityContext {
                user_id: ctx["user"]["id"].as_str(),
                status: ctx["status"].as_str().unwrap(),
                presentation_account_id: ctx["presentationAccountId"].as_str(),
                observed_epoch_milliseconds: epoch,
            },
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(prepared.selected_indices()).unwrap(),
            c["expected"]["selected"]
        );
        let captured = prepared.capture_timeline_at(epoch).unwrap();
        let native = captured
            .project(
                i["timeZone"].as_str().unwrap(),
                Some(i["publishedEpochMilliseconds"].as_i64().unwrap() as f64),
                None,
            )
            .unwrap();
        let _: Value = serde_json::to_value(native).unwrap();
        let clock = WidgetClock::from_epoch(
            i["publishedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let facts = locale["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == c["id"])
            .unwrap();
        let ranks: CollationRanks = serde_json::from_value(facts["ranks"].clone()).unwrap();
        let wire = serde_json::to_value(
            clock
                .business_timeline_from_incoming(
                    &[],
                    &ranks,
                    &captured,
                    WidgetRowOptions {
                        show_shifts: true,
                        show_appointments: true,
                        show_shift_times: true,
                        show_shift_duration: true,
                    },
                    true,
                )
                .unwrap(),
        )
        .unwrap();
        let expected = c["expected"]["frames"].as_array().unwrap();
        let actual = wire.as_array().unwrap();
        assert_eq!(actual.len(), expected.len(), "{}", c["id"]);
        for (n, e) in actual.iter().zip(expected) {
            assert_eq!(
                n["observedEpochMilliseconds"], e["observedEpochMilliseconds"],
                "{}",
                c["id"]
            );
            for key in ["todayDate", "month", "monthTitle", "state"] {
                assert_eq!(n[key], e["props"][key], "{}:{key}", c["id"])
            }
        }
        frames += actual.len();
        if dump_path.is_some() {
            dumped.push(json!({"id":c["id"],"frames":wire}));
        }
    }
    assert_eq!(frames, 1101);
    if let Some(path) = dump_path {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        file.write_all(&serde_json::to_vec(&dumped).unwrap())
            .unwrap();
    }
}
