use luna_engine::input::profile_editor::ProfileFields;
use luna_engine::input::{InputError, profile_write as policy};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn source_history_and_target_remain_borrowed_outside_profile_storage_fields() {
    use std::sync::Arc;
    struct Source {
        fields: Value,
        metadata: Arc<Value>,
    }
    impl ProfileFields for Source {
        fn field(&self, key: &str) -> Option<&Value> {
            assert!(!["employmentTimeline", "workingTimeTarget"].contains(&key));
            self.fields.get(key)
        }
    }
    let d = value_pool::decode(include_str!(
        "../../reference/profile-write-policy-golden.json"
    ));
    let i: Value = serde_json::from_str(d["cases"][0]["inputJson"].as_str().unwrap()).unwrap();
    let metadata = Arc::new(
        json!({"days":(0..50_000).map(|i|json!({"date":i,"targetMinutes":462})).collect::<Vec<_>>()}),
    );
    let source = Source {
        fields: i["raw"].clone(),
        metadata: metadata.clone(),
    };
    let checked = policy::normalize_profile_input(&source, None).unwrap();
    assert_eq!(checked, d["cases"][0]["expected"]["value"]);
    assert!(serde_json::to_vec(&checked).unwrap().len() < 8192);
    assert!(Arc::ptr_eq(&metadata, &source.metadata));
    assert_eq!(Arc::strong_count(&metadata), 2);
}
#[test]
fn actual_original_profile_normalization_financial_metadata_patches_and_storage_rows_match() {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-write-policy-golden.json"
    ));
    assert_eq!(d["cases"].as_array().unwrap().len(), 924);
    for c in d["cases"].as_array().unwrap() {
        let i: Value = serde_json::from_str(c["inputJson"].as_str().unwrap()).unwrap();
        let result: Result<Value, InputError> = match c["operation"].as_str().unwrap() {
            "NORMALIZE_PROFILE" => policy::normalize_profile_input(
                &i["raw"],
                i.get("current").filter(|v| !v.is_null()),
            ),
            "EMPLOYMENT_WITH_REMUNERATION" => {
                policy::employment_with_remuneration(&i["base"], &i["data"])
            }
            "FINANCIAL_DATA" => {
                policy::financial_data(i.get("before").filter(|v| !v.is_null()), &i["profile"])
            }
            "DIFF_APPLY" => (|| {
                let patch = policy::changes(&i["before"], &i["after"])?;
                let fields = patch
                    .iter()
                    .map(|p| {
                        policy::field(&i["before"], p)
                            .cloned()
                            .unwrap_or(Value::Null)
                    })
                    .collect::<Vec<_>>();
                let applied = policy::apply(&i["before"], &patch)?;
                Ok(json!({"patch":patch,"fields":fields,"applied":applied}))
            })(),
            "PROFILE_ROWS" => policy::profile_rows(&i["profile"], i["now"].as_str().unwrap())
                .map(|rows| rows.reference_json()),
            _ => panic!("operation"),
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
}
