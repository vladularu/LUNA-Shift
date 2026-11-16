use luna_engine::input::profile_write::{ProfileWriteRoute, ProfileWriteSource};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn original_sqlite_profile_save_and_app_receipts_match_native_raw_row_policy() {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-write-sql-golden.json"
    ));
    assert_eq!(d["cases"].as_array().unwrap().len(), 1104);
    let dump = std::env::var_os("LUNA_PROFILE_WRITE_PLAN_DUMP");
    let mut plans = vec![];
    for c in d["cases"].as_array().unwrap() {
        let i = &c["input"];
        let source = ProfileWriteSource::try_from_raw_state(i["state"].clone()).unwrap();
        let input: Value = serde_json::from_str(i["rawInputJson"].as_str().unwrap()).unwrap();
        let route = if i["route"] == "APP_PORT" {
            ProfileWriteRoute::AppPort
        } else {
            ProfileWriteRoute::EmploymentRepository
        };
        let actual = match source.prepare(
            &input,
            route,
            i["observedEpochMilliseconds"].as_f64().unwrap(),
        ) {
            Ok(plan) => {
                if dump.is_some() {
                    plans.push(json!({"id":c["id"],"body":plan.value(),"returnedProfile":plan.returned_profile()}));
                }
                json!({"result":{"ok":true,"value":plan.returned_profile()},"state":plan.reference_state(),"inTransaction":false})
            }
            Err(error) => {
                if dump.is_some() {
                    plans.push(json!({"id":c["id"],"body":null,"error":{"name":error.name(),"message":error.message(),"userFacing":error.is_user_facing()}}));
                }
                json!({"result":{"ok":false,"error":{"name":error.name(),"message":error.message(),"userFacing":error.is_user_facing()}},"state":i["state"],"inTransaction":false})
            }
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
    if let Some(file) = dump {
        let value = json!({"schemaVersion":1,"producer":"ACTUAL_RUST_POLICY_TEST","engineVersion":luna_engine::ENGINE_VERSION,"fixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/profile-write-sql-golden.json"))),"cases":plans});
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(bytes.len() <= 67_108_864);
        std::fs::write(file, bytes).unwrap();
    }
}
