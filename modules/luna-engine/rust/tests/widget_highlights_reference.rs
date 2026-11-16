mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::widget::widget_calendar_highlights, credit::context::DailyCreditContextCache,
    rules::RuleResolver,
};
#[test]
fn all_original_widget_holiday_and_tariff_highlights_keep_exact_order_and_profiles() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/widget-highlights-golden.json"
    ));
    let resolver = RuleResolver::bundled().unwrap();
    let mut count = 0;
    for c in corpus["cases"].as_array().unwrap() {
        let i = &c["input"];
        let before = i["profile"].clone();
        let mut cache = DailyCreditContextCache::new(&i["profile"], &resolver);
        let actual = widget_calendar_highlights(
            i["range"]["startDate"].as_str().unwrap(),
            i["range"]["endDate"].as_str().unwrap(),
            &mut cache,
        )
        .unwrap_or_else(|error| panic!("{}:{error:?}", c["id"]));
        common::assert_json_eq(
            &serde_json::to_value(actual).unwrap(),
            &c["expected"],
            c["id"].as_str().unwrap(),
        );
        assert_eq!(i["profile"], before);
        count += 1;
    }
    assert_eq!(count, 72);
}
