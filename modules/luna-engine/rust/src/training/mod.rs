//! Native training profile/detail facts and content-bound confirmations.
mod adult;
mod bindings;
mod daily;
mod days;
mod details;
mod entries;
mod exam;
mod feature;
mod feature_adult;
mod helpers;
mod interval_math;
mod profile;
mod reporting;
mod school;
mod travel;
mod weeks;
mod youth;
mod youth_codes;
mod youth_credit;
mod youth_report;
pub use adult::{AdultTrainingResult, calculate_adult_training};
pub use bindings::{
    is_current_shift_training, require_shift_training_parent, validate_saved_shift_training,
    youth_block_shift_binding,
};
pub use daily::check_youth_daily;
pub use days::{SchoolMode, TrainingDay, prepare_school_days};
pub use details::validate_shift_training_data;
pub use entries::{
    PreparationProblem, PreparedYouthEntries, YouthEntry, YouthPreparationStats, YouthSource,
};
pub use exam::{ExamCredits, assess_youth_exams};
pub use feature::{
    AssessedTrainingMonth, TrainingComplianceError, TrainingLoad,
    calculate_training_compliance_for_state,
};
pub use interval_math::{YouthSpan, clock_minutes, union_minutes, week_start};
pub use profile::{
    PreparedTrainingProfiles, training_profile_for_date, training_revision,
    validate_training_profile,
};
pub use reporting::TrainingEvent;
pub use school::{SchoolCredits, school_credits};
pub use travel::{
    activity as training_activity_bounds, exam as located_exam_travel,
    school as located_school_travel,
};
pub use weeks::check_youth_weekly;
pub use youth::{YouthComplianceDraft, prepare_youth_compliance};
pub use youth_codes::code_candidates;
pub use youth_credit::{PreparedYouthAssessment, prepare_youth_assessment};
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrainingError {
    name: &'static str,
    message: String,
}
impl TrainingError {
    pub fn name(&self) -> &str {
        self.name
    }
    pub fn message(&self) -> &str {
        &self.message
    }
    pub(super) fn source(name: &'static str, message: impl Into<String>) -> Self {
        Self {
            name,
            message: message.into(),
        }
    }
    pub(super) fn invalid(message: impl Into<String>) -> Self {
        Self::source("Error", message)
    }
}
impl std::fmt::Display for TrainingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for TrainingError {}
