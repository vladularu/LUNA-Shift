#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::incoming::{
    SharedDayWindow, cache::RetainedIncomingCache, visible::VisibilityContext,
};

#[test]
fn complete_original_sequential_cache_hook_and_projection_states_match() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/incoming-retention-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 4);
    let mut compared = 0;
    for case in corpus["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut state = RetainedIncomingCache::new();
        let window = input
            .get("window")
            .filter(|v| !v.is_null())
            .map(|v| SharedDayWindow {
                start_date: v["startDate"].as_str().unwrap(),
                end_date: v["endDate"].as_str().unwrap(),
            });
        for (index, step) in input["steps"].as_array().unwrap().iter().enumerate() {
            let epoch = step["observedEpochMilliseconds"].as_i64().unwrap();
            let context = &step["context"];
            let observed = state
                .observe(
                    step["calendars"].as_array().unwrap().clone(),
                    &VisibilityContext {
                        user_id: context["user"]["id"].as_str(),
                        status: context["status"].as_str().unwrap(),
                        presentation_account_id: context["presentationAccountId"].as_str(),
                        observed_epoch_milliseconds: epoch,
                    },
                )
                .unwrap_or_else(|e| panic!("{}:{index}:{e:?}", case["id"]));
            let actual = observed
                .compatibility_value(input["timeZone"].as_str().unwrap(), epoch, window.as_ref())
                .unwrap();
            assert_eq!(
                actual, case["expected"]["frames"][index],
                "{}:{index}:{}",
                case["id"], step["kind"]
            );
            compared += 1;
        }
    }
    assert_eq!(compared, 92);
}
