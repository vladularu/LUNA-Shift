//! No totals are calculated here. Each field comes from its native producer.
use super::{MonthlyAnalysisOverlay, required};
use crate::runtime::report::{ReportIssue, SectionOutput};
use serde_json::{Value, json};
pub(crate) fn time(value: &Value, compliance_shifts: Value) -> Result<Value, ReportIssue> {
    let value = MonthlyAnalysisOverlay {
        monthly_analysis: json!({"monthShifts":required(value,"monthShifts")?,"summary":required(value,"summary")?,"shiftTypeAnalysis":required(value,"shiftTypeAnalysis")?,"complianceShifts":compliance_shifts}),
    };
    serde_json::to_value(value).map_err(|_| ReportIssue::new("VIEW_OUTPUT_INVALID"))
}
pub(crate) fn gross(pay: Value) -> Value {
    json!(MonthlyAnalysisOverlay {
        monthly_analysis: json!({"pay":pay})
    })
}
pub(crate) fn checks(value: &Value) -> Result<Value, ReportIssue> {
    let adult = required(value, "compliance")?;
    let result = match value.get("training").filter(|v| !v.is_null()) {
        Some(training) => json!({"ok":true,"value":training}),
        None => adult.clone(),
    };
    let display = |show| {
        SectionOutput::from_result(match result["ok"] {
            Value::Bool(true) => required(&result, "value")
                .and_then(|value| {
                    crate::compliance::checks::select_visible_compliance(value, show)
                        .map_err(|_| ReportIssue::new("CHECKS_DISPLAY_INVALID"))
                })
                .map(|value| json!({"ok":true,"value":value})),
            Value::Bool(false) => Ok(result.clone()),
            _ => Err(ReportIssue::new("VIEW_OUTPUT_INVALID")),
        })
    };
    let visible = display(true);
    let hidden = display(false);
    Ok(
        json!({"monthlyCompliance":result,"trainingState":required(value,"trainingState")?,"planningVisibleMonthlyCompliance":visible,"planningHiddenMonthlyCompliance":hidden}),
    )
}
