use super::model::RawAdjustment;
use super::rules::{HolidayWork, TariffRules};
use super::*;

pub(crate) fn line(
    date: &str,
    kind: AdjustmentKind,
    label: &str,
    numerator: i64,
    source: &RuleSource,
    condition: &str,
    status: AdjustmentStatus,
) -> RawAdjustment {
    RawAdjustment {
        date: date.into(),
        kind,
        label: label.into(),
        numerator,
        source: source.clone(),
        condition: condition.into(),
        status,
    }
}
pub(crate) fn final_fact(fact: Option<&TargetDayFact>, disposition: Disposition) -> bool {
    fact.is_some_and(|f| f.roster_status == RosterStatus::Final && f.disposition == disposition)
}
pub(crate) fn special_label(date: &str) -> &'static str {
    if date.ends_with("-24") {
        "Heiligabend (tariflicher Sondertag)"
    } else {
        "Silvester (tariflicher Sondertag)"
    }
}
pub(crate) fn push_notice(
    notices: &mut Vec<TargetNotice>,
    keys: &mut std::collections::BTreeSet<(String, Option<String>)>,
    date: Option<&str>,
    code: &str,
    message: impl Into<String>,
    affects: bool,
) {
    let key = (code.to_owned(), date.map(str::to_owned));
    if keys.insert(key) {
        notices.push(TargetNotice {
            date: date.map(str::to_owned),
            code: code.into(),
            message: message.into(),
            affects_target: affects,
        })
    }
}
pub(crate) fn special_reduction(
    date: &str,
    label: &str,
    fact: Option<&TargetDayFact>,
    rules: &TariffRules,
    automatic: Option<i64>,
    verified: bool,
    notice: &mut impl FnMut(Option<&str>, &str, String, bool),
) -> Option<RawAdjustment> {
    if final_fact(fact, Disposition::WorkRequired) {
        notice(Some(date),"COMPENSATORY_LEAVE_SEPARATE","Arbeit am tariflichen Sondertag: Freizeitausgleich nach § 6 Abs. 3 Satz 2 separat prüfen. Kein Abzug allein wegen der Arbeitsleistung.".into(),false);
        return None;
    }
    if final_fact(fact, Disposition::RosterFree)
        && fact.is_some_and(|f| f.must_work_elsewhere == Some(false))
    {
        return None;
    }
    let eligible = verified
        && fact.is_some_and(|f| {
            f.roster_status == RosterStatus::Final
                && f.lost_minutes.is_some()
                && (f.disposition == Disposition::Released
                    || f.disposition == Disposition::RosterFree
                        && f.must_work_elsewhere == Some(true))
        });
    Some(line(
        date,
        AdjustmentKind::TariffSpecialDay,
        label,
        if eligible {
            fact.and_then(|f| f.lost_minutes).unwrap_or(0) * 5
        } else {
            automatic.unwrap_or(0)
        },
        if automatic.is_some() {
            &rules.special_forecast
        } else {
            &rules.special
        },
        if eligible {
            if final_fact(fact, Disposition::Released) {
                "Bestätigte Freistellung und ausgefallene Arbeitszeit"
            } else {
                "Bestätigt dienstplanmäßig frei; ohne Verminderung nachzuarbeiten; ausgefallene Stunden bestätigt"
            }
        } else if automatic.is_some() {
            "Automatischer Planwert: Freistellung oder planmäßig frei mit Nacharbeit angenommen; gleichmäßige Referenzstunden. Individuelle Ausfallstunden können abweichen."
        } else {
            "Abschließender Dienstplan und ausgefallene Stunden beziehungsweise Nacharbeitspflicht fehlen"
        },
        if eligible {
            AdjustmentStatus::Confirmed
        } else if automatic.is_some() {
            AdjustmentStatus::ProfileEstimate
        } else {
            AdjustmentStatus::Pending
        },
    ))
}
// Parameter order mirrors the reviewed daily policy and keeps its eligibility flags explicit.
#[allow(clippy::too_many_arguments)]
pub(crate) fn rotating_holiday(
    date: &str,
    label: &str,
    weekly: i64,
    fact: Option<&TargetDayFact>,
    rules: &TariffRules,
    estimate: bool,
    verified: bool,
    notice: &mut impl FnMut(Option<&str>, &str, String, bool),
) -> Option<RawAdjustment> {
    if let HolidayWork::SeparateCompensation { legal_basis } = &rules.holiday_work
        && final_fact(fact, Disposition::WorkRequired)
    {
        notice(
            Some(date),
            "HOLIDAY_TIME_OFF_SEPARATE",
            format!(
                "Feiertagsarbeit: Freizeitausgleich nach {legal_basis} getrennt prüfen; kein pauschaler Fünftelabzug von der Sollzeit."
            ),
            false,
        );
        return None;
    }
    if final_fact(fact, Disposition::RosterFree)
        && fact.is_some_and(|f| f.must_work_elsewhere == Some(false))
    {
        return None;
    }
    let eligible = verified
        && fact.is_some_and(|f| {
            f.roster_status == RosterStatus::Final
                && (f.disposition == Disposition::WorkRequired
                    || f.disposition == Disposition::RosterFree
                        && f.must_work_elsewhere == Some(true))
        });
    let condition = if eligible {
        if final_fact(fact, Disposition::WorkRequired) {
            "Bestätigter 7-Tage-Schichtplan und Arbeitspflicht am Werktagsfeiertag".into()
        } else {
            "Bestätigter 7-Tage-Schichtplan; dienstplanmäßig frei, nicht wegen des Feiertags; regelmäßige Arbeitszeit andernorts zu erbringen".into()
        }
    } else if estimate {
        if matches!(rules.holiday_work, HolidayWork::SeparateCompensation { .. }) {
            "Planungsreferenz für qualifiziert dienstplanmäßig freie Werktagsfeiertage: ein Fünftel der Wochenstunden. Kein bestätigter Tagesanspruch; Feiertagsarbeit und Freizeitausgleich werden getrennt behandelt.".into()
        } else {
            "Monatsprognose im 7-Tage-Modell: ein Fünftel der Wochenstunden je Werktagsfeiertag, unabhängig von eingetragenen Diensten.".into()
        }
    } else {
        format!(
            "Anspruch nach {} nicht abschließend bestätigt; Freistellung und Zeitgutschrift gegebenenfalls separat prüfen",
            rules.holiday.legal_basis
        )
    };
    Some(line(
        date,
        AdjustmentKind::StatutoryHoliday,
        label,
        if eligible || estimate { weekly } else { 0 },
        if estimate {
            &rules.holiday_forecast
        } else {
            &rules.holiday
        },
        &condition,
        if eligible {
            AdjustmentStatus::Confirmed
        } else if estimate {
            AdjustmentStatus::ProfileEstimate
        } else {
            AdjustmentStatus::Pending
        },
    ))
}

pub(crate) struct PolicyDay<'a> {
    pub date: &'a str,
    pub weekday: usize,
    pub holiday: Option<&'a str>,
    pub fact: Option<&'a TargetDayFact>,
    pub rules: &'a TariffRules,
    pub forecast: bool,
}

pub(crate) fn tvuk(
    day: PolicyDay<'_>,
    period: &TargetPeriod,
    reviewed: bool,
    notice: &mut impl FnMut(Option<&str>, &str, String, bool),
) -> Result<Option<RawAdjustment>, TargetError> {
    let PolicyDay {
        date,
        weekday,
        holiday,
        fact,
        rules,
        forecast,
    } = day;
    if holiday.is_none() && !date.ends_with("-12-24") && !date.ends_with("-12-31") {
        return Ok(None);
    }
    let loss = rules
        .tv_uk_loss
        .as_ref()
        .ok_or(TargetError::MissingTvUkDayRule)?;
    let fixed = period.model.fixed();
    let fixed_minutes = fixed.map(|v| v[weekday - 1]);
    let confirmed_shift = period.model.rotating() && period.model.confirmed() == Some(true);
    let account = period.tariff.account_rule_confirmed == Some(true)
        || (period.tariff.account_rule_confirmed.is_none() && confirmed_shift);
    let account_forecast = forecast
        && period.tariff.account_rule_confirmed.is_none()
        && period.model.rotating()
        && period.model.confirmed() != Some(false);
    let account_reference = account || account_forecast;
    let applicable = reviewed && period.tariff.scope_confirmed != Some(false);
    if forecast && applicable {
        notice(Some(&period.valid_from),"TARGET_RULE_FORECAST",if account_reference{"TV-UK Pflege BW: Planwert nach § 13 nur Montag bis Freitag, unabhängig von Diensten."}else if period.tariff.account_rule_confirmed==Some(false){"TV-UK Pflege BW: Planwert nach § 8 aus festen Tagesstunden außerhalb des Kontenbereichs."}else{"TV-UK Pflege BW: Planwert nach § 8 aus festen Tagesstunden; Kontenbereich nach § 13 ungeklärt."}.into(),true)
    }
    if weekday == 7 || account_reference && weekday == 6 {
        return Ok(None);
    }
    let kind = if holiday.is_some() {
        AdjustmentKind::StatutoryHoliday
    } else {
        AdjustmentKind::TariffSpecialDay
    };
    let label = holiday.unwrap_or_else(|| special_label(date));
    let source = if account_reference {
        if forecast {
            &rules.holiday_forecast
        } else {
            &rules.holiday
        }
    } else if forecast {
        &loss.forecast
    } else {
        &loss.actual
    };
    let make = |n, status, condition| Some(line(date, kind, label, n, source, condition, status));
    if !applicable || !forecast && period.tariff.scope_confirmed != Some(true) {
        return Ok(make(
            0,
            AdjustmentStatus::Pending,
            "Tariffassung oder persönlicher Geltungsbereich nicht bestätigt",
        ));
    }
    if account_reference {
        return Ok(make(
            period.weekly_minutes,
            if forecast {
                AdjustmentStatus::ProfileEstimate
            } else {
                AdjustmentStatus::Confirmed
            },
            if forecast {
                "Monatsprognose im Kontenbereich: ein Fünftel der Wochenzeit, ausschließlich Montag bis Freitag; keine Dienstplanbestätigung"
            } else {
                "Bestätigter Kontenbereich nach § 13 Abs. 1: Fünftelabzug Montag bis Freitag, unabhängig von Arbeit oder frei"
            },
        ));
    }
    if forecast && fixed.is_some() {
        return Ok(if fixed_minutes.unwrap_or(0) > 0 {
            make(
                fixed_minutes.unwrap_or(0) * 5,
                AdjustmentStatus::ProfileEstimate,
                "Planungsreferenz: feste Tagesstunden fallen aus; persönlicher Kontenbereich kann abweichen",
            )
        } else {
            None
        });
    }
    if period.tariff.account_rule_confirmed != Some(false) {
        return Ok(make(
            0,
            AdjustmentStatus::Pending,
            "Anwendbarer Kontenbereich oder tatsächlicher Stundenausfall nicht bestätigt",
        ));
    }
    if fixed_minutes == Some(0) || final_fact(fact, Disposition::WorkRequired) {
        return Ok(None);
    }
    if fixed.is_some()
        && final_fact(fact, Disposition::Released)
        && fact.and_then(|f| f.lost_minutes).is_some()
    {
        let lost = fact.and_then(|f| f.lost_minutes).unwrap_or(0);
        if lost > fixed_minutes.unwrap_or(0) {
            return Err(TargetError::InvalidInput);
        }
        return Ok(make(
            lost * 5,
            AdjustmentStatus::Confirmed,
            "Außerhalb des Kontenbereichs: bestätigte Freistellung mit ausgefallenen festen Tagesstunden",
        ));
    }
    Ok(make(
        0,
        AdjustmentStatus::Pending,
        "§ 8 Abs. 3: tatsächlicher Ausfall und Abgrenzung zu regelmäßig frei nicht belegt",
    ))
}
pub(crate) fn tval(
    day: PolicyDay<'_>,
    base: i64,
    verified: bool,
    notice: &mut impl FnMut(Option<&str>, &str, String, bool),
) -> Option<RawAdjustment> {
    let PolicyDay {
        date,
        weekday,
        holiday,
        fact,
        rules,
        forecast,
    } = day;
    if holiday.is_none() && !date.ends_with("-12-24") && !date.ends_with("-12-31") || weekday == 7 {
        return None;
    }
    if final_fact(fact, Disposition::WorkRequired) {
        notice(Some(date),if holiday.is_some(){"HOLIDAY_TIME_OFF_SEPARATE"}else{"COMPENSATORY_LEAVE_SEPARATE"},"Arbeit am Feiertag oder Sondertag: Zeitgutschrift und Freizeitausgleich getrennt prüfen.".into(),false);
        return None;
    }
    if final_fact(fact, Disposition::RosterFree)
        && fact.is_some_and(|f| f.must_work_elsewhere == Some(false))
    {
        return None;
    }
    if forecast && base == 0 {
        return None;
    }
    let confirmed = verified
        && fact.is_some_and(|f| {
            f.roster_status == RosterStatus::Final
                && f.lost_minutes.is_some()
                && (f.disposition == Disposition::Released
                    || f.disposition == Disposition::RosterFree
                        && f.must_work_elsewhere == Some(true))
        });
    if !forecast && !confirmed && base == 0 && fact.and_then(|f| f.lost_minutes).is_none() {
        return None;
    }
    let source = if holiday.is_some() {
        if forecast {
            &rules.holiday_forecast
        } else {
            &rules.holiday
        }
    } else if forecast {
        &rules.special_forecast
    } else {
        &rules.special
    };
    Some(line(
        date,
        if holiday.is_some() {
            AdjustmentKind::StatutoryHoliday
        } else {
            AdjustmentKind::TariffSpecialDay
        },
        holiday.unwrap_or_else(|| special_label(date)),
        if confirmed {
            fact.and_then(|f| f.lost_minutes).unwrap_or(0) * 5
        } else if forecast {
            base
        } else {
            0
        },
        source,
        if confirmed {
            "Bestätigte ausgefallene Stunden nach allgemeiner Arbeitgeberregel; kein pauschales Fünftel"
        } else if forecast {
            "Vorläufige Montag-bis-Freitag-Verluststundenreferenz. Arbeitgebergeltung und individuelle Ausfallstunden nicht bestätigt; kein pauschaler Samstagsabzug."
        } else {
            "Arbeitgebergeltung und ausgefallene Stunden nicht abschließend bestätigt"
        },
        if confirmed {
            AdjustmentStatus::Confirmed
        } else if forecast {
            AdjustmentStatus::ProfileEstimate
        } else {
            AdjustmentStatus::Pending
        },
    ))
}
