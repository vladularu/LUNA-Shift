use super::*;
use crate::calendar::recurrence::CollationRanks;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn corpus() -> Value {
    crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-loaded-join-golden.json"
    ))
}
fn ranks(data: &Value) -> CollationRanks {
    CollationRanks::from(
        data["collationRanks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                (
                    pair[0].as_str().unwrap().to_owned(),
                    pair[1].as_u64().unwrap() as u32,
                )
            })
            .collect::<BTreeMap<_, _>>(),
    )
}
fn source(raw: &Value) -> Arc<RawScopeRows> {
    RawScopeRows::new(
        Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
        Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
        Arc::from(raw["templateRows"].as_array().unwrap().clone()),
    )
    .unwrap()
}
fn view(book: &ScopeEntries) -> Value {
    json!(book.entries().iter().map(Arc::as_ref).collect::<Vec<_>>())
}
fn start(
    jobs: &mut Vec<(u64, ScopeEntries)>,
    case: &Value,
    start: ScopeLoadStart,
    ranks: &CollationRanks,
) {
    let ScopeLoadStart::Read { load, range, .. } = start else {
        return;
    };
    let capture = &case["input"]["captures"][jobs.len()];
    assert_eq!(json!(range), capture["range"]);
    let entries = source(&capture["rawSource"])
        .prepare(&range)
        .unwrap()
        .finish(ranks)
        .unwrap();
    jobs.push((load, entries));
}
#[test]
fn original_template_provider_overlay_and_background_identity_keep_actual_submit_capture() {
    let data = corpus();
    let ranks = ranks(&data);
    let mut frames = 0;
    for case in data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["id"].as_str().unwrap().starts_with("provider/"))
    {
        let mut scope = CalendarLoadedScope::default();
        let mut jobs = Vec::new();
        let mut completed = 0;
        let mut writes = 0;
        let mut captured = None;
        let epoch = case["input"]["observedEpochMilliseconds"].as_i64().unwrap();
        let first = scope
            .active_month(case["input"]["activeMonth"].as_str().unwrap(), epoch)
            .unwrap();
        start(&mut jobs, case, first, &ranks);
        assert_eq!(
            view(scope.entries()),
            case["expected"]["frames"][0]["entries"]
        );
        frames += 1;
        for (index, step) in case["input"]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let frame = &case["expected"]["frames"][index + 1];
            match step["kind"].as_str().unwrap() {
                "LOAD" => {
                    let (load, entries) = &jobs[completed];
                    scope
                        .complete(*load, Ok(entries.clone()), None, &ranks)
                        .unwrap();
                    completed += 1;
                }
                "BACKGROUND" => {
                    let request = scope.reload(true, epoch).unwrap();
                    start(&mut jobs, case, request, &ranks);
                }
                "SUBMIT" => captured = Some(scope.entries().clone()),
                "COMMIT" => {
                    let completion = &frame["completions"][writes];
                    writes += 1;
                    assert_eq!(completion["kind"], "TEMPLATE");
                    let id = &completion["rawInput"]["id"];
                    let row = completion["physical"]["templateRows"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|row| row["id"] == *id)
                        .unwrap();
                    let display = TemplateDisplay::from_write_row(Arc::new(row.clone())).unwrap();
                    scope.publish_template(display);
                }
                "OPEN" | "FIELD" => {}
                other => panic!("unexpected original provider event {other}"),
            }
            assert_eq!(
                view(scope.entries()),
                frame["entries"],
                "{} full effective original entries at frame{}",
                case["id"],
                index + 1
            );
            if let Some(captured) = &captured {
                assert_eq!(
                    view(captured),
                    frame["capturedSubmissions"][0]["entries"],
                    "{} immutable SUBMIT capture at frame{}",
                    case["id"],
                    index + 1
                );
            }
            assert_eq!(json!(scope.status())["ready"], frame["loader"]["ready"]);
            frames += 1;
        }
    }
    assert_eq!(frames, 15);
}

#[test]
fn native_template_overlay_keeps_base_and_unaffected_identity_while_effective_sort_and_draft_fences_advance()
 {
    let data = corpus();
    let ranks = ranks(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "provider/template-display-update-without-full-resort")
        .unwrap();
    let mut scope = CalendarLoadedScope::default();
    let epoch = case["input"]["observedEpochMilliseconds"].as_i64().unwrap();
    let ScopeLoadStart::Read { load, range, .. } = scope.active_month("2026-11", epoch).unwrap()
    else {
        panic!();
    };
    let before = source(&case["input"]["initial"])
        .prepare(&range)
        .unwrap()
        .finish(&ranks)
        .unwrap();
    scope
        .complete(load, Ok(before.clone()), None, &ranks)
        .unwrap();
    let last = case["expected"]["frames"]
        .as_array()
        .unwrap()
        .last()
        .unwrap();
    let completion = &last["completions"][0];
    let row = completion["physical"]["templateRows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == completion["rawInput"]["id"])
        .unwrap();
    let display = TemplateDisplay::from_write_row(Arc::new(row.clone())).unwrap();
    let ScopeLoadStart::Read { load, .. } = scope.reload(true, epoch).unwrap() else {
        panic!();
    };
    let draft = scope
        .prepare_completion(load, Ok(before.clone()), None)
        .unwrap();
    scope.publish_template(display);
    assert!(matches!(
        scope.finish_completion(draft, &ranks),
        Err(ScopeError::StaleDraft)
    ));
    for (old, current) in before.entries().iter().zip(scope.entries().entries()) {
        assert!(
            Arc::ptr_eq(&old.value, &current.value),
            "all original JSON bases remain shared"
        );
        if old.get("templateId") == Some(&row["id"]) {
            assert!(!Arc::ptr_eq(old, current));
            assert_eq!(old.get("title").unwrap(), "Z first");
            assert_eq!(current.get("title").unwrap(), "A changed");
        } else {
            assert!(
                Arc::ptr_eq(old, current),
                "unaffected original object identity is preserved"
            );
        }
    }
    assert_eq!(view(scope.entries()), last["entries"]);
    assert!(scope.entries().collation_candidates().contains("A changed"));
    assert!(!scope.entries().collation_candidates().contains("Z first"));
    let sorted = ScopeEntries::sorted(scope.entries().entries().to_vec(), &ranks).unwrap();
    assert_eq!(
        view(&sorted)[0]["title"],
        "A changed",
        "shared comparator reads effective overlay fields"
    );
    assert_eq!(
        view(scope.entries())[0]["title"],
        "Y second",
        "template publication itself never sorts"
    );
    scope.complete(load, Ok(before), None, &ranks).unwrap();
    assert_eq!(
        view(scope.entries())[0]["title"],
        "A changed",
        "real background completion applies original reconcile/sort"
    );
}

#[test]
fn template_overlay_fifty_thousand_handles_never_copy_base_json_and_small_projection_releases_input()
 {
    let data = corpus();
    let ranks = ranks(&data);
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "provider/template-display-update-without-full-resort")
        .unwrap();
    let initial = &case["input"]["initial"];
    let range = CalendarLoadRange::for_month("2026-11").unwrap();
    let book = source(initial)
        .prepare(&range)
        .unwrap()
        .finish(&ranks)
        .unwrap();
    let completion = &case["expected"]["frames"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()["completions"][0];
    let row = completion["physical"]["templateRows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == completion["rawInput"]["id"])
        .unwrap();
    let changed = book
        .entries()
        .iter()
        .find(|entry| entry.get("templateId") == Some(&row["id"]))
        .unwrap()
        .clone();
    // Synthetic handle fan-out probes sharing only; duplicate IDs are not a
    // Source admission claim. The actual50k raw-query test is separate.
    let mut scope = CalendarLoadedScope::default();
    let ScopeLoadStart::Read { load, .. } = scope
        .active_month(
            "2026-11",
            case["input"]["observedEpochMilliseconds"].as_i64().unwrap(),
        )
        .unwrap()
    else {
        panic!();
    };
    scope
        .complete(
            load,
            Ok(ScopeEntries(Arc::from(vec![changed.clone(); 50_000]))),
            None,
            &ranks,
        )
        .unwrap();
    let mut raw = row.clone();
    raw["ignored_test_tree"] = json!((0..50_000).collect::<Vec<_>>());
    let raw = Arc::new(raw);
    let weak = Arc::downgrade(&raw);
    let display = TemplateDisplay::from_write_row(raw.clone()).unwrap();
    drop(raw);
    assert!(
        weak.upgrade().is_none(),
        "small native display retains only four scalar fields"
    );
    scope.publish_template(display);
    assert_eq!(scope.entries().entries().len(), 50_000);
    for entry in scope.entries().entries() {
        assert!(Arc::ptr_eq(&entry.value, &changed.value));
        assert_eq!(entry.get("title").unwrap(), "A changed");
    }
    let mut invalid = row.clone();
    invalid["sort_order"] = json!(0.5);
    assert!(
        TemplateDisplay::from_write_row(Arc::new(invalid)).is_err(),
        "original post-write map failure is never a published overlay"
    );
}
