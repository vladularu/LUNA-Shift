//! Pure native profile-write policies. Inputs come from the editor's private
//! source/current/captured roles; output rows are not reusable Ready facts.
pub(crate) mod command;
mod compatibility;
mod patch;
mod rows;
mod sql;
mod sql_history;
mod sql_state;
use super::InputError;
pub(crate) const SALARY_KEYS: &[&str] = &[
    "tariff",
    "manualMonthlyGrossCents",
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
];
use compatibility::normalize_profile_input_without_identity;
pub use compatibility::{employment_with_remuneration, financial_data, normalize_profile_input};
pub use patch::{EmploymentPatch, apply, changes, field};
pub use rows::{PreferenceWrite, ProfileStorageRows, profile_rows};
pub use sql::{NativeProfileWritePlan, ProfileWriteError, ProfileWriteRoute, ProfileWriteSource};
fn invalid() -> InputError {
    InputError::validation("Die gespeicherten Beschäftigungsangaben sind ungültig.")
}
