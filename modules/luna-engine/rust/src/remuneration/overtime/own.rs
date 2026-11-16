use super::OvertimeError;
use crate::remuneration::{
    allowances::model::*,
    base::{model::RemunerationStatus, round_remuneration_cents},
    own_config::{OwnBase, OwnConfiguration, OwnRate},
};
pub(super) fn unavailable<'a>(
    mut line: SupplementPosition<'a>,
    code: SupplementIssueKind,
    message: &str,
) -> SupplementPosition<'a> {
    line.amount_cents = None;
    line.status = RemunerationStatus::Unavailable;
    line.issue = Some(SupplementIssue::new(code, message));
    line
}
pub(super) fn calculate<'a>(
    position: SupplementPosition<'a>,
    configuration: &OwnConfiguration,
) -> Result<Vec<SupplementPosition<'a>>, OvertimeError> {
    let Some(extra) = configuration.overtime() else {
        return Ok(vec![unavailable(
            position,
            SupplementIssueKind::OwnOvertimeUnconfigured,
            "Bitte die Auszahlungsregeln für eigene Mehr- und Überstunden einrichten.",
        )]);
    };
    let hourly = matches!(configuration.base(), OwnBase::Hourly { .. });
    let rate = match configuration.base() {
        OwnBase::Hourly { cents_per_hour } => Some(*cents_per_hour),
        OwnBase::Monthly { .. } => configuration.percentage_basis_hourly_cents(),
    };
    let mut base = position.clone();
    base.label = if extra.base_pay_included {
        "Überstunden-Grundvergütung bereits enthalten"
    } else {
        "Eigene Überstunden-Grundvergütung"
    }
    .into();
    base.amount_cents = Some(0);
    base.basis.rate_cents = if extra.base_pay_included { None } else { rate };
    if hourly && !extra.base_pay_included {
        base = unavailable(
            base,
            SupplementIssueKind::OwnOvertimeUnconfigured,
            "Beim Stundenlohn sind alle erfassten Dienstminuten bereits bezahlt. Bitte für Überstunden „Grundvergütung bereits enthalten“ bestätigen; sie darf nicht nochmals addiert werden.",
        );
    } else if !extra.base_pay_included {
        if let Some(rate) = rate {
            base.amount_cents = Some(round_remuneration_cents(
                rate as f64 * position.basis.minutes,
                60.0,
            )?);
        } else {
            base = unavailable(
                base,
                SupplementIssueKind::OvertimeRateMissing,
                "Bitte den Stundenwert für die zusätzliche Überstunden-Grundvergütung bestätigen.",
            );
        }
    }
    let Some(premium) = &extra.premium else {
        return Ok(vec![base]);
    };
    let mut line = position.clone();
    line.id.push_str(":premium");
    line.kind = SupplementKind::OvertimePremium;
    line.label = "Eigener Mehr-/Überstundenzuschlag".into();
    match premium {
        OwnRate::Hourly { cents_per_hour } => {
            line.basis.rate_cents = Some(*cents_per_hour);
            line.basis.percentage_basis_points = None;
            line.amount_cents = Some(round_remuneration_cents(
                *cents_per_hour as f64 * position.basis.minutes,
                60.0,
            )?);
        }
        OwnRate::Percent { basis_points } => {
            line.basis.rate_cents = rate;
            line.basis.percentage_basis_points = Some(*basis_points);
            if *basis_points > 0 && rate.is_none() {
                line = unavailable(
                    line,
                    SupplementIssueKind::OvertimeRateMissing,
                    "Bitte die Stundenbasis für den prozentualen Überstundenzuschlag bestätigen.",
                );
            } else {
                line.amount_cents = Some(round_remuneration_cents(
                    rate.unwrap_or(0) as f64 * *basis_points as f64 * position.basis.minutes,
                    600_000.0,
                )?);
            }
        }
    }
    Ok(vec![base, line])
}
