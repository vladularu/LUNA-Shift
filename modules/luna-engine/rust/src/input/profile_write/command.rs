//! Existing raw SQLite profile policy exposed without an editor controller.
use super::{ProfileWriteRoute, ProfileWriteSource};
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Route {
    AppPort,
    EmploymentRepository,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    state: Value,
    input: Value,
    observed_epoch_milliseconds: f64,
    route: Option<Route>,
}
pub(crate) fn execute(body: &[u8]) -> Result<Value, &'static str> {
    let input: Input = serde_json::from_slice(body).map_err(|_| "INVALID_PROFILE_WRITE_INPUT")?;
    let source = match ProfileWriteSource::try_from_raw_state(input.state) {
        Ok(source) => source,
        Err(error) => {
            return Ok(
                json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}),
            );
        }
    };
    let route = match input.route {
        Some(Route::AppPort) => ProfileWriteRoute::AppPort,
        Some(Route::EmploymentRepository) | None => ProfileWriteRoute::EmploymentRepository,
    };
    match source.prepare(&input.input, route, input.observed_epoch_milliseconds) {
        Ok(plan) => Ok(
            json!({"state":"WRITE_PLAN","body":serde_json::to_string(plan.value()).map_err(|_|"PROFILE_WRITE_LIMIT")?,"profile":plan.returned_profile()}),
        ),
        Err(error) => Ok(
            json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":error.is_user_facing()}),
        ),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_profile_command_preserves_all_original_sqlite_results_and_errors() {
        let corpus = crate::test_value_pool::decode(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/profile-write-sql-golden.json"
        )));
        let mut outputs = Vec::new();
        for case in corpus["cases"].as_array().unwrap() {
            let input = &case["input"];
            let body = json!({"state":input["state"],"input":serde_json::from_str::<Value>(input["rawInputJson"].as_str().unwrap()).unwrap(),"route":input["route"],"observedEpochMilliseconds":input["observedEpochMilliseconds"]});
            let output = execute(&serde_json::to_vec(&body).unwrap()).unwrap();
            let expected = &case["expected"]["result"];
            if expected["ok"] == true {
                assert_eq!(output["state"], "WRITE_PLAN", "{}", case["id"]);
                assert_eq!(output["profile"], expected["value"], "{}", case["id"]);
                outputs.push(json!({"id":case["id"],"body":serde_json::from_str::<Value>(output["body"].as_str().unwrap()).unwrap(),"returnedProfile":output["profile"]}));
            } else {
                assert_eq!(output["state"], "RECORD_ERROR", "{}", case["id"]);
                for key in ["name", "message", "userFacing"] {
                    assert_eq!(output[key], expected["error"][key], "{}:{key}", case["id"]);
                }
                outputs.push(json!({"id":case["id"],"body":null,"error":{"name":output["name"],"message":output["message"],"userFacing":output["userFacing"]}}));
            }
        }
        assert_eq!(outputs.len(), 1104);
        if let Ok(path) = std::env::var("LUNA_PROFILE_COMMAND_NATIVE_OUTPUT") {
            use sha2::{Digest, Sha256};
            use std::io::Write;
            let fixture = include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../reference/profile-write-sql-golden.json"
            ));
            let dump = json!({"schemaVersion":1,"producer":"ACTUAL_RUST_POLICY_TEST","engineVersion":crate::ENGINE_VERSION,"fixtureSha256":format!("{:x}",Sha256::digest(fixture)),"cases":outputs});
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            file.write_all(&serde_json::to_vec(&dump).unwrap()).unwrap();
        }
    }
}
