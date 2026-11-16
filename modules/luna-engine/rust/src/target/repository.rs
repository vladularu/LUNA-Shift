//! Raw stored target settings on the existing large presentation channel.
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
enum Command {
    MapRow { row: Value },
    MapChunks { row: Value },
    ValidateSettings { settings: Value },
}
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let input = crate::contract::bounded_json(raw).map_err(|_| "INVALID_TARGET_SETTINGS_INPUT")?;
    let command: Command =
        serde_json::from_value(input).map_err(|_| "INVALID_TARGET_SETTINGS_INPUT")?;
    let result = match command {
        Command::MapChunks { row } => {
            crate::input::working_time_target::RawSavedWorkingTimeTarget::try_from_raw_row_chunks(
                &row,
            )
            .map(|saved| saved.saved().clone())
        }
        Command::MapRow { row } => {
            crate::input::working_time_target::map_working_time_target_row(&row)
        }
        Command::ValidateSettings { settings } => super::validate_saved_target_settings(&settings),
    };
    Ok(match result {
        Ok(value) => json!({"state":"VALUE","value":value}),
        Err(error) => {
            json!({"state":"RECORD_ERROR","name":"WorkingTimeTargetError","message":error.to_string()})
        }
    })
}
