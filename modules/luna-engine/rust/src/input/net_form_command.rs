//! Closed raw editor intent; never calculation evidence or a source Ready flag.
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum NetFormCommand {
    Values {
        #[serde(default)]
        initial: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    SetupValues {
        #[serde(default)]
        initial: Option<Value>,
        #[serde(default)]
        federal_state: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetupEditor {
        #[serde(default)]
        initial: Option<Value>,
        #[serde(default)]
        federal_state: Option<String>,
        church_tax_default_percent: u8,
    },
    PrepareMonthly {
        month: String,
        form: Value,
    },
    ValidateStep {
        month: String,
        step: u32,
        form: Value,
    },
    #[serde(rename_all = "camelCase")]
    PrepareSetup {
        month: String,
        form: Value,
        #[serde(default)]
        pension_scheme: Option<String>,
        additional_gross: String,
        additional_net: String,
        #[serde(default)]
        initial: Option<Value>,
        #[serde(default)]
        pension_employee_rate: String,
    },
    ParseAmounts {
        form: Value,
    },
}
