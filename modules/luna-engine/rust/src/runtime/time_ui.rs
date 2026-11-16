//! Display-only projection of a privately calculated native time views.
use super::report::{ReportIssue, SectionOutput};
use crate::report::time_display;
use serde_json::json;

pub fn with_month_overlay(base: SectionOutput) -> SectionOutput {
    match base {
        SectionOutput::Ready { mut value } => {
            let display = value
                .get("monthlyAnalysis")
                .and_then(|month| Some((month.get("summary")?, month.get("shiftTypeAnalysis")?)));
            let display = match display {
                Some((summary, analysis)) => time_display::present(summary, analysis)
                    .and_then(|mut value| {
                        value["dashboardCard"] =
                            time_display::present_dashboard(summary, analysis)?;
                        Ok(SectionOutput::Ready { value })
                    })
                    .unwrap_or_else(|_| SectionOutput::Unavailable {
                        reason: ReportIssue::new("TIME_DISPLAY_UNAVAILABLE"),
                    }),
                None => SectionOutput::Unavailable {
                    reason: ReportIssue::new("TIME_DISPLAY_UNAVAILABLE"),
                },
            };
            value["worktimeDisplay"] = json!(display);
            SectionOutput::Ready { value }
        }
        other => other,
    }
}

fn year_frame(source: Option<&SectionOutput>, pending: bool) -> SectionOutput {
    match source {
        Some(SectionOutput::Ready { value }) => SectionOutput::from_result(
            time_display::present_year(value, pending)
                .map_err(|_| ReportIssue::new("ANNUAL_TIME_DISPLAY_UNAVAILABLE")),
        ),
        Some(SectionOutput::Unavailable { reason }) => SectionOutput::Unavailable {
            reason: reason.clone(),
        },
        _ => SectionOutput::NotRequested {},
    }
}
/// Core and completed time reports keep separate, honest presentation frames.
/// Only existing private native outputs are projected; no source or calculator is invoked.
pub fn with_year_overlay(
    base: SectionOutput,
    output: &SectionOutput,
    core: Option<&SectionOutput>,
) -> SectionOutput {
    let mut value = match base {
        SectionOutput::Ready { value } => value,
        other => json!({"legacyState":other}),
    };
    value["annualTimeDisplay"] = json!({"complete":year_frame(Some(output),false),"partial":year_frame(Some(output),true),"core":year_frame(core,true)});
    SectionOutput::Ready { value }
}
