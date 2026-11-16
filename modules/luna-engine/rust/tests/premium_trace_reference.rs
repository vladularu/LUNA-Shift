use luna_engine::net::premium_trace::{
    NetPayPremiumTrace, PremiumTraceError, premium_category, premium_kind,
};
use serde_json::{Value, json};

fn trace(input: &Value) -> Result<Value, PremiumTraceError> {
    let start_ms = input["startMilliseconds"].as_i64();
    let start = input["start"].as_i64().unwrap_or(0);
    let construct = if start_ms.is_some() {
        NetPayPremiumTrace::new_milliseconds
    } else {
        NetPayPremiumTrace::new
    };
    let mut trace = construct(
        input["id"].as_str().expect("id").into(),
        start_ms.unwrap_or(start),
        input["grossMinutes"].as_i64().expect("gross"),
        input["pauseMinutes"].as_i64().expect("pause"),
        input["paidBreaks"].as_bool().expect("paid"),
    )?;
    if let Some(ranges) = input["minuteRanges"].as_array() {
        for range in ranges {
            for offset in
                range["from"].as_i64().expect("from")..range["until"].as_i64().expect("until")
            {
                let key = range["key"].as_str().expect("key");
                if let Some(start) = start_ms {
                    trace.add_milliseconds(key, start + offset * 60_000)?;
                } else {
                    trace.add(key, start + offset)?;
                }
            }
        }
    }
    if let Some(minutes) = input["minutes"].as_array() {
        for minute in minutes {
            let key = minute[0].as_str().expect("key");
            let offset = minute[1].as_i64().expect("offset");
            if let Some(start) = start_ms {
                trace.add_milliseconds(key, start + offset * 60_000)?;
            } else {
                trace.add(key, start + offset)?;
            }
        }
    }
    for payment in input["payments"].as_array().expect("payments") {
        trace.pay(
            payment["key"].as_str().expect("key"),
            payment["kind"].as_str().expect("kind"),
            payment["amountCents"].as_i64().expect("cents"),
            payment["category"].as_str(),
        )?;
    }
    trace.finish()
}

#[test]
fn raw_minute_trace_and_paid_break_money_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/premium-trace-golden.json"))
            .expect("trace golden");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 175);
    for case in cases {
        let actual =
            trace(&case["input"]).unwrap_or_else(|error| json!({"$error":error.to_string()}));
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
    let mappings = reference["mappings"].as_array().expect("mappings");
    assert_eq!(mappings.len(), 18);
    for mapping in mappings {
        let key = mapping["key"].as_str().expect("key");
        assert_eq!(premium_kind(key), mapping["kind"].as_str().expect("kind"));
        assert_eq!(
            premium_category(key),
            mapping["category"].as_str().expect("category")
        );
    }
}
