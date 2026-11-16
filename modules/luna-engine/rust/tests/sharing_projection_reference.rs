mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::sharing::{PublicIdBinding, SharingProjectionDraft};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[test]
fn sharing_matches_complete_original_projection_identities_and_confirmation_signature() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/sharing-projection-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1784);
    for case in cases {
        let raw = Arc::new(case["entries"].as_array().unwrap().clone());
        let draft = SharingProjectionDraft::prepare(raw.clone(), &case["options"]).unwrap();
        assert!(Arc::ptr_eq(&raw, draft.source_owner()));
        assert_eq!(
            draft.identity_candidate_count(),
            case["candidates"].as_array().unwrap().len(),
            "{}",
            case["id"]
        );
        let mut candidates = Vec::new();
        for offset in (0..draft.identity_candidate_count()).step_by(7) {
            candidates.extend(draft.identity_candidates_page(offset, 7).unwrap());
        }
        common::assert_json_eq(
            &serde_json::to_value(candidates).unwrap(),
            &case["candidates"],
            case["id"].as_str().unwrap(),
        );
        let selected = draft.projection_candidates().unwrap();
        common::assert_json_eq(
            &json!(selected.iter().map(|c| c.slot).collect::<Vec<_>>()),
            &case["projectionSlots"],
            case["id"].as_str().unwrap(),
        );
        let bindings = selected
            .iter()
            .map(|c| PublicIdBinding {
                slot: c.slot,
                public_id: case["publicIds"][c.slot].as_str().unwrap_or("").to_owned(),
            })
            .collect::<Vec<_>>();
        let actual = match draft.finish(&bindings) {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":error}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn original_count_limits_hidden_identity_pages_and_split_pages_are_preserved() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/sharing-projection-golden.json"
    ));
    for recipe in fixture["boundaryRecipes"].as_array().unwrap() {
        let count = recipe["count"].as_u64().unwrap() as usize;
        let source = Arc::new(
            (0..count)
                .map(|index| {
                    let mut row = recipe["template"].clone();
                    row["id"] = json!(format!("row-{index}"));
                    row
                })
                .collect(),
        );
        let weak = Arc::downgrade(&source);
        let draft = SharingProjectionDraft::prepare(source, &recipe["options"]).unwrap();
        assert_eq!(
            draft.identity_candidate_count(),
            recipe["identityCount"].as_u64().unwrap() as usize
        );
        for page in recipe["pages"].as_array().unwrap() {
            let actual = draft
                .identity_candidates_page(
                    page["offset"].as_u64().unwrap() as usize,
                    page["limit"].as_u64().unwrap() as usize,
                )
                .unwrap();
            common::assert_json_eq(
                &serde_json::to_value(actual).unwrap(),
                &page["candidates"],
                recipe["id"].as_str().unwrap(),
            );
        }
        assert!(draft.identity_candidates_page(0, 1025).is_err());
        assert!(
            draft
                .identity_candidates_page(draft.identity_candidate_count() + 1, 1)
                .is_err()
        );
        let selected = draft.projection_candidates().unwrap();
        assert!(selected.len() <= 10_001);
        if recipe["id"].as_str().unwrap().starts_with("hidden") {
            assert!(selected.is_empty());
            assert_eq!(draft.owned_projection_time_count(), 0);
            assert!(weak.upgrade().is_some());
        }
        let bindings = selected
            .iter()
            .map(|c| PublicIdBinding {
                slot: c.slot,
                public_id: "00000000-0000-4000-8000-000000000001".into(),
            })
            .collect::<Vec<_>>();
        let actual = match draft.finish(&bindings) {
            Err(error) => json!({"error":error}),
            Ok(result) => {
                json!({"length":result.entries.len(),"first":result.entries.first(),"last":result.entries.last(),"signatureSha256":format!("{:x}",Sha256::digest(result.signature.as_bytes()))})
            }
        };
        assert!(weak.upgrade().is_none());
        common::assert_json_eq(&actual, &recipe["expected"], recipe["id"].as_str().unwrap());
    }
}

#[test]
fn binding_guards_safe_errors_and_immutable_owner_are_native() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/sharing-projection-golden.json"
    ));
    let case = &fixture["cases"][0];
    let source = Arc::new(case["entries"].as_array().unwrap().clone());
    let prepare = || SharingProjectionDraft::prepare(source.clone(), &case["options"]).unwrap();
    let draft = prepare();
    assert!(Arc::ptr_eq(draft.source_owner(), &source));
    assert_eq!(draft.owned_projection_time_count(), 0);
    assert!(draft.finish(&[]).is_err());
    let duplicate = [
        PublicIdBinding {
            slot: 0,
            public_id: "00000000-0000-4000-8000-000000000001".into(),
        },
        PublicIdBinding {
            slot: 0,
            public_id: "00000000-0000-4000-8000-000000000001".into(),
        },
    ];
    assert!(prepare().finish(&duplicate).is_err());
    assert!(
        prepare()
            .finish(&[PublicIdBinding {
                slot: 999999,
                public_id: "private-secret".into()
            }])
            .is_err()
    );
    let error = prepare()
        .finish(&[PublicIdBinding {
            slot: 0,
            public_id: "private-secret".into(),
        }])
        .err()
        .unwrap();
    assert_eq!(error.code, "SHARE_INVALID_PUBLIC_ID");
    assert!(!error.to_string().contains("private-secret"));
    assert!(
        SharingProjectionDraft::prepare(
            source,
            &json!({"timeZone":"UTC","visibility":"DETAILS","computedReady":true})
        )
        .is_err()
    );
    let oversized = Arc::new(vec![serde_json::Value::Null; 50_001]);
    assert_eq!(
        SharingProjectionDraft::prepare(
            oversized,
            &json!({"timeZone":"UTC","visibility":"DETAILS"})
        )
        .err()
        .unwrap()
        .code,
        "SHARE_INPUT_TOO_LARGE"
    );
}
