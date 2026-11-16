//! Raw, snapshot-bound payroll editor intent. No computed money or Ready input.
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PayrollFormCommand {
    SetupSource { month: String },
    AnnualBootstrap { month: String },
    AnnualEditor { month: String },
    AnnualSave { month: String, form: Value },
    AnnualReset { month: String },
    TimingPrepare { month: String, choice: String },
}
impl PayrollFormCommand {
    pub fn month(&self) -> &str {
        match self {
            Self::SetupSource { month }
            | Self::AnnualBootstrap { month }
            | Self::AnnualEditor { month }
            | Self::AnnualSave { month, .. }
            | Self::AnnualReset { month }
            | Self::TimingPrepare { month, .. } => month,
        }
    }
}
