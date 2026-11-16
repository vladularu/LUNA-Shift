use std::env::VarError;

/// Cargo omits CARGO_CFG_TARGET_FEATURE when rustc reports an empty set.
/// All other build identity fields remain mandatory, including panic policy.
pub fn build_value(name: &str, value: Result<String, VarError>) -> Result<String, VarError> {
    match value {
        Err(VarError::NotPresent) if name == "CARGO_CFG_TARGET_FEATURE" => Ok(String::new()),
        value => value,
    }
}
