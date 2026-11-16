use super::model::RawAdjustment;
use super::policies::*;
use super::rules::{self, HolidayWork};
use super::validation::{regional, valid_date, validate};
use super::*;
use crate::rules::{RuleResolver, holidays::holiday_map_for_month};
use std::collections::{BTreeMap, BTreeSet};

struct RawDay {
    date: String,
    base: i64,
    unavailable: bool,
    adjustments: Vec<RawAdjustment>,
}
struct Notices {
    items: Vec<TargetNotice>,
    keys: BTreeSet<(String, Option<String>)>,
}
impl Notices {
    fn add(&mut self, date: Option<&str>, code: &str, message: impl Into<String>, affects: bool) {
        push_notice(
            &mut self.items,
            &mut self.keys,
            date,
            code,
            message,
            affects,
        )
    }
}
// The ledger numerator is an integer fifth of one minute. No fractional-minute truncation.
fn round_fifth(value: i64) -> i64 {
    (value + 2).div_euclid(5)
}
fn round_ledger(month: &str, raw: &[RawDay], notices: &[TargetNotice]) -> MonthlyTarget {
    let (
        mut base,
        mut statutory,
        mut tariff,
        mut previous_base,
        mut previous_statutory,
        mut previous_tariff,
        mut previous_target,
    ) = (0, 0, 0, 0, 0, 0, 0);
    let mut adjustments = Vec::new();
    let mut days = Vec::new();
    for day in raw {
        base += day.base;
        let (mut statutory_minutes, mut tariff_minutes) = (0, 0);
        for a in &day.adjustments {
            let is_statutory = a.kind == AdjustmentKind::StatutoryHoliday;
            let before = if is_statutory { statutory } else { tariff };
            if is_statutory {
                statutory += a.numerator
            } else {
                tariff += a.numerator
            }
            let minutes = round_fifth(before + a.numerator) - round_fifth(before);
            if is_statutory {
                statutory_minutes += minutes
            } else {
                tariff_minutes += minutes
            }
            adjustments.push(TargetAdjustment {
                date: a.date.clone(),
                kind: a.kind,
                label: a.label.clone(),
                minutes,
                source: a.source.clone(),
                condition: a.condition.clone(),
                status: a.status,
            });
        }
        let (next_base, next_statutory, next_tariff, next_target) = (
            round_fifth(base),
            round_fifth(statutory),
            round_fifth(tariff),
            round_fifth(base - statutory - tariff),
        );
        let base_minutes = next_base - previous_base;
        let target_minutes = next_target - previous_target;
        days.push(DailyTarget {
            date: day.date.clone(),
            base_minutes,
            statutory_reduction_minutes: statutory_minutes,
            tariff_reduction_minutes: tariff_minutes,
            rounding_minutes: target_minutes - base_minutes + statutory_minutes + tariff_minutes,
            target_minutes: if day.unavailable {
                None
            } else {
                Some(target_minutes)
            },
        });
        (
            previous_base,
            previous_statutory,
            previous_tariff,
            previous_target,
        ) = (next_base, next_statutory, next_tariff, next_target);
    }
    let unavailable = raw.iter().any(|d| d.unavailable) || previous_target < 0;
    let pending = adjustments
        .iter()
        .any(|a| a.status != AdjustmentStatus::Confirmed)
        || notices.iter().any(|n| n.affects_target);
    MonthlyTarget {
        month: month.into(),
        status: if unavailable {
            TargetStatus::Unavailable
        } else if pending {
            TargetStatus::Provisional
        } else {
            TargetStatus::Final
        },
        base_minutes: previous_base,
        statutory_reduction_minutes: previous_statutory,
        tariff_reduction_minutes: previous_tariff,
        rounding_minutes: previous_target - previous_base + previous_statutory + previous_tariff,
        target_minutes: if unavailable {
            None
        } else {
            Some(previous_target)
        },
        adjustments,
        notices: notices.to_vec(),
        days,
    }
}

pub fn calculate_monthly_working_time_target(
    month: &str,
    profile: &TargetProfile,
    resolver: &RuleResolver,
    context: Option<&TargetContext>,
) -> Result<MonthlyTarget, TargetError> {
    calculate(month, profile, resolver, context, None)
}
pub(crate) fn calculate(
    month: &str,
    profile: &TargetProfile,
    resolver: &RuleResolver,
    context: Option<&TargetContext>,
    prepared: Option<&super::prepared::ContextIndex>,
) -> Result<MonthlyTarget, TargetError> {
    let input = profile.working_time_target.as_ref();
    if let Some(input) = input {
        match input.status {
            InputStatus::Loading => return Err(TargetError::Loading),
            InputStatus::Error => return Err(TargetError::ReadError),
            InputStatus::Ready => {}
        }
    }
    let context = context.or_else(|| input.and_then(|i| i.context.as_ref()));
    if let Some(index) = prepared {
        super::validation::validate_profile(month, profile)?;
        if !context.is_some_and(|context| index.matches(context)) {
            return Err(TargetError::InvalidInput);
        }
    } else {
        validate(month, profile, context)?;
    }
    let first = valid_date(&format!("{month}-01"))?;
    let forecast = input.and_then(|i| i.mode) == Some(TargetMode::Forecast);
    let facts: BTreeMap<_, _> = if forecast || prepared.is_some() {
        BTreeMap::new()
    } else {
        context
            .map(|c| c.days.iter().map(|f| (f.date.as_str(), f)).collect())
            .unwrap_or_default()
    };
    let mut notices = Notices {
        items: input.map(|i| i.notices.clone()).unwrap_or_default(),
        keys: BTreeSet::new(),
    };
    if forecast {
        notices.add(None,"CONTRACTUAL_TARGET_FORECAST","Sollzeit-Prognose aus den Beschäftigungsangaben. Einzelne Dienste, Zeitgutschriften und Freizeitausgleich werden getrennt berechnet.",true)
    }
    if context.is_none() {
        notices.add(None,"LEGACY_WORK_MODEL_UNKNOWN","Vorläufige Montag-bis-Freitag-Referenz: Arbeitszeitmodell, historische Geltung und tarifliche Ansprüche sind nicht bestätigt.",true)
    }
    let mut holiday_maps = BTreeMap::new();
    let mut raw = Vec::new();
    for number in 1..=first.days_in_month() {
        let plain = first
            .with()
            .day(number)
            .build()
            .map_err(|_| TargetError::InvalidInput)?;
        let date = plain.to_string();
        let weekday = plain.weekday().to_monday_one_offset() as usize;
        let empty = RawDay {
            date: date.clone(),
            base: 0,
            unavailable: false,
            adjustments: vec![],
        };
        if context
            .and_then(|c| c.employment.as_ref())
            .is_some_and(|b| date < b.from || b.to.as_ref().is_some_and(|to| &date > to))
        {
            raw.push(empty);
            continue;
        }
        let period = context.and_then(|c| {
            c.periods
                .iter()
                .find(|p| p.valid_from <= date && p.valid_to.as_ref().is_none_or(|to| &date <= to))
        });
        if context.is_some() && period.is_none() {
            notices.add(
                Some(&date),
                "WORK_PROFILE_MISSING",
                "Für diesen Tag fehlen historische Arbeitszeitangaben.",
                true,
            );
            raw.push(RawDay {
                unavailable: true,
                ..empty
            });
            continue;
        }
        let weekly = period
            .map(|p| p.weekly_minutes)
            .unwrap_or(profile.weekly_minutes);
        let state = period
            .map(|p| p.federal_state.as_str())
            .unwrap_or(&profile.federal_state);
        let region = period
            .map(|p| p.holiday_region.as_str())
            .or(profile.holiday_region.as_deref())
            .unwrap_or("NONE");
        let fixed = period.and_then(|p| p.model.fixed());
        let base = if let Some(fixed) = fixed {
            fixed[weekday - 1] * 5
        } else if weekday <= 5 {
            weekly
        } else {
            0
        };
        if context.is_some() && regional(state) {
            let region_unknown = region == "UNKNOWN";
            let unsupported = resolver
                .resolve_holiday(&date)
                .is_ok_and(|p| p.engine_contract_version < 2);
            if region_unknown || unsupported {
                notices.add(period.map(|p|p.valid_from.as_str()),if region_unknown{"HOLIDAY_REGION_UNKNOWN"}else{"HOLIDAY_REGION_UNSUPPORTED"},if region_unknown{"Die Feiertagsregion des Arbeitsorts ist nicht bestätigt."}else{"Für diesen Arbeitsort ist ein Feiertagskatalog mit geprüften regionalen Regeln erforderlich."},true);
                raw.push(RawDay {
                    date,
                    base,
                    unavailable: true,
                    adjustments: vec![],
                });
                continue;
            }
        }
        let key = (state.to_owned(), region.to_owned());
        if !holiday_maps.contains_key(&key) {
            holiday_maps.insert(
                key.clone(),
                holiday_map_for_month(month, state, region, resolver)?,
            );
        }
        let holiday = holiday_maps
            .get(&key)
            .and_then(|h| h.get(&date))
            .map(|h| h.name.as_str());
        let fact = if forecast {
            None
        } else if let (Some(index), Some(context)) = (prepared, context) {
            index.fact(context, &date)
        } else {
            facts.get(date.as_str()).copied()
        };
        let mut adjustments = vec![];
        let tariff = period.map(|p| &p.tariff);
        let training = tariff.is_some_and(TargetTariff::training);
        if training
            && input
                .and_then(|i| i.youth_protection_status)
                .is_some_and(|s| s != InputStatus::Ready)
        {
            let status = input.and_then(|i| i.youth_protection_status);
            notices.add(None,if status==Some(InputStatus::Loading){"TRAINING_YOUTH_PREFERENCE_LOADING"}else{"TRAINING_YOUTH_PREFERENCE_ERROR"},if status==Some(InputStatus::Loading){"Die Jugendschutz-Einstellung wird geladen."}else{"Die Jugendschutz-Einstellung konnte nicht geladen werden. Bitte erneut versuchen."},true);
            raw.push(RawDay {
                date,
                base,
                adjustments: vec![],
                unavailable: true,
            });
            continue;
        }
        if training && input.and_then(|i| i.youth_protection) == Some(true) {
            notices.add(None,"TRAINING_YOUTH_TARGET_UNSUPPORTED","Für Auszubildende mit aktivem Jugendschutz ist die Sollzeitprognose noch nicht verfügbar.",true);
            raw.push(RawDay {
                date,
                base,
                adjustments: vec![],
                unavailable: true,
            });
            continue;
        }
        let supported = tariff.is_some_and(TargetTariff::reviewed_kind);
        let reviewed = tariff.and_then(|t| rules::reviewed(t, &date));
        let verified = reviewed.is_some()
            && supported
            && tariff.is_some_and(|t| t.scope_confirmed == Some(true));
        let forecast_tariff = forecast
            && reviewed.is_some()
            && supported
            && tariff.is_some_and(|t| t.scope_confirmed != Some(false));
        if training
            && forecast
            && supported
            && tariff.is_some_and(|t| t.scope_confirmed != Some(false))
            && let Some(r) = reviewed
        {
            notices.add(None,"TARGET_RULE_FORECAST",format!("{}: {}",r.label,r.training_qualifier.as_deref().unwrap_or("Referenz nach § 7 ohne Jugendarbeitsschutz. Unterricht und Ausgleich separat.")),true)
        }
        if forecast_tariff
            && holiday.is_some()
            && weekday <= 6
            && period.is_some_and(|p| p.model.rotating() && p.model.confirmed() != Some(false))
            && reviewed
                .is_some_and(|r| matches!(r.holiday_work, HolidayWork::SeparateCompensation { .. }))
            && !tariff.is_some_and(|t| {
                matches!(
                    t.kind,
                    TariffKind::TvalCommon | TariffKind::TvalGeneral | TariffKind::TvalKr
                )
            })
            && let Some(r) = reviewed
        {
            notices.add(None,"CONDITIONAL_ROSTER_FREE_FORECAST",format!("{}: {}",r.label,r.forecast_qualifier.as_deref().unwrap_or("Planwert für dienstplanmäßig freie Feiertage. Feiertagsarbeit und Freizeitausgleich werden getrennt geprüft.")),true)
        }
        let legacy_inferred = forecast
            && tariff.is_some_and(|t| {
                t.kind != TariffKind::TvoedK && t.reviewed_kind() && t.scope_confirmed.is_none()
            })
            && reviewed.is_none();
        if let Some(p) = period {
            tariff_notices(p, reviewed.is_some(), &mut notices)?
        }
        if let Some(p) = period {
            if p.tariff.kind == TariffKind::TvukNursing
                && !legacy_inferred
                && (!matches!(p.model, WorkModel::Unknown)
                    || p.tariff.account_rule_confirmed == Some(true))
            {
                let r = if let Some(r) = reviewed {
                    r
                } else {
                    rules::known(p.tariff.kind)?
                };
                let a = tvuk(
                    PolicyDay {
                        date: &date,
                        weekday,
                        holiday,
                        fact,
                        rules: r,
                        forecast,
                    },
                    p,
                    reviewed.is_some(),
                    &mut |d, c, m, a| notices.add(d, c, m, a),
                )?;
                if let Some(a) = a {
                    adjustments.push(a)
                }
                raw.push(RawDay {
                    date,
                    base,
                    adjustments,
                    unavailable: false,
                });
                continue;
            }
            if p.model.rotating()
                && matches!(
                    p.tariff.kind,
                    TariffKind::TvalCommon | TariffKind::TvalGeneral
                )
                && let Some(r) = reviewed
            {
                if let Some(a) = tval(
                    PolicyDay {
                        date: &date,
                        weekday,
                        holiday,
                        fact,
                        rules: r,
                        forecast: forecast_tariff,
                    },
                    base,
                    verified && p.tariff.kind == TariffKind::TvalGeneral,
                    &mut |d, c, m, a| notices.add(d, c, m, a),
                ) {
                    adjustments.push(a)
                }
                raw.push(RawDay {
                    date,
                    base,
                    adjustments,
                    unavailable: false,
                });
                continue;
            }
        }
        if let Some(holiday) = holiday {
            if fixed.is_some() && base > 0 {
                if fact.is_some_and(|f| {
                    f.roster_status == RosterStatus::Draft
                        || matches!(
                            f.disposition,
                            Disposition::Unknown | Disposition::RosterFree
                        )
                }) {
                    adjustments.push(line(
                        &date,
                        AdjustmentKind::StatutoryHoliday,
                        holiday,
                        0,
                        rules::base("fixedHoliday")?,
                        "Abweichender oder unvollständiger Dienstplan am festen Arbeitstag",
                        AdjustmentStatus::Pending,
                    ));
                } else if fact.is_some_and(|f| f.disposition == Disposition::WorkRequired) {
                    notices.add(Some(&date),"HOLIDAY_TIME_OFF_SEPARATE","Feiertagsarbeit außerhalb der bestätigten 7-Tage-Regel: Freizeitausgleich und Zeitkonto separat prüfen.",true)
                } else {
                    let loss = fact
                        .and_then(|f| f.lost_minutes)
                        .map(|m| m * 5)
                        .unwrap_or(base);
                    if loss > base {
                        return Err(TargetError::InvalidInput);
                    }
                    adjustments.push(line(&date,AdjustmentKind::StatutoryHoliday,holiday,loss,rules::base("fixedHoliday")?,"Feste vertragliche Tagesverteilung; reguläre Arbeitszeit fällt wegen des Feiertags aus",AdjustmentStatus::Confirmed));
                }
            } else if period.is_some_and(|p| p.model.rotating())
                && supported
                && !legacy_inferred
                && weekday <= 6
            {
                let t = tariff.ok_or(TargetError::InvalidInput)?;
                let r = if let Some(r) = reviewed {
                    r
                } else {
                    rules::known(t.kind)?
                };
                let confirmed = period.is_some_and(|p| p.model.confirmed() == Some(true));
                if let Some(a) = rotating_holiday(
                    &date,
                    holiday,
                    weekly,
                    fact,
                    r,
                    forecast_tariff && period.is_some_and(|p| p.model.confirmed() != Some(false)),
                    verified && confirmed,
                    &mut |d, c, m, a| notices.add(d, c, m, a),
                ) {
                    adjustments.push(a)
                }
            } else if fixed.is_none() && base > 0 {
                adjustments.push(line(
                    &date,
                    AdjustmentKind::StatutoryHoliday,
                    holiday,
                    base,
                    rules::base("legacyHoliday")?,
                    "Unbestätigte bisherige Referenzverteilung",
                    AdjustmentStatus::LegacyEstimate,
                ));
            }
        } else if (date.ends_with("-12-24") || date.ends_with("-12-31"))
            && (verified || forecast_tariff)
            && weekday <= 6
            && if fixed.is_some() {
                base > 0
            } else {
                period.is_some_and(|p| {
                    p.model.rotating()
                        && (p.model.confirmed() == Some(true)
                            || forecast_tariff && p.model.confirmed() != Some(false))
                })
            }
        {
            if fixed.is_some()
                && fact
                    .and_then(|f| f.lost_minutes)
                    .is_some_and(|m| m * 5 > base)
            {
                return Err(TargetError::InvalidInput);
            }
            let automatic = if forecast_tariff {
                Some(if fixed.is_some() { base } else { weekly })
            } else {
                None
            };
            if let Some(a) = special_reduction(
                &date,
                special_label(&date),
                fact,
                reviewed.ok_or(TargetError::InvalidInput)?,
                automatic,
                verified
                    && (fixed.is_some()
                        || period.is_some_and(|p| {
                            p.model.rotating() && p.model.confirmed() == Some(true)
                        })),
                &mut |d, c, m, a| notices.add(d, c, m, a),
            ) {
                adjustments.push(a)
            }
        }
        raw.push(RawDay {
            date,
            base,
            adjustments,
            unavailable: false,
        });
    }
    let result = round_ledger(month, &raw, &notices.items);
    if result.target_minutes.is_none() && !raw.iter().any(|d| d.unavailable) {
        notices.add(None,"NEGATIVE_MONTH_TARGET","Die bestätigte Referenzverteilung und die Abzüge ergeben eine negative Monatssollzeit. Betriebliche Teilmonatsberechnung prüfen.",true);
        return Ok(round_ledger(month, &raw, &notices.items));
    }
    Ok(result)
}

fn tariff_notices(
    period: &TargetPeriod,
    reviewed: bool,
    notices: &mut Notices,
) -> Result<(), TargetError> {
    let t = &period.tariff;
    let at = Some(period.valid_from.as_str());
    if matches!(period.model, WorkModel::Unknown) {
        notices.add(
            at,
            "WORK_MODEL_UNKNOWN",
            "Die Verteilung der Arbeitszeit ist nicht bestätigt; nur Referenzberechnung.",
            true,
        )
    }
    if t.kind == TariffKind::Unverified {
        notices.add(
            at,
            "TARIFF_UNSUPPORTED",
            format!(
                "Die Sollzeit-Sonderregeln für {} sind noch nicht angebunden.",
                t.id.as_deref().unwrap_or("")
            ),
            true,
        )
    }
    if t.kind == TariffKind::Custom && period.model.rotating() {
        notices.add(at,"CUSTOM_ROTATING_REFERENCE","Eigene Vergütung im wechselnden Dienstplan: gesetzliche Ausfallzeiten und betriebliche Referenzberechnung prüfen; keine zusätzlichen Tarifansprüche angesetzt.",true)
    }
    if t.reviewed_kind() {
        let r = rules::known(t.kind)?;
        if t.scope_confirmed != Some(true) {
            notices.add(
                at,
                "TARIFF_SCOPE_UNCONFIRMED",
                format!("Die Geltung des {} ist nicht bestätigt.", r.label),
                true,
            )
        }
        if !reviewed {
            notices.add(
                at,
                "TARIFF_VERSION_UNREVIEWED",
                "Für Tarifstand oder Berechnungsdatum liegt noch keine geprüfte Sollzeitregel vor.",
                true,
            )
        }
        if !matches!(
            t.kind,
            TariffKind::TvukNursing | TariffKind::TvalCommon | TariffKind::TvalGeneral
        ) && period.model.rotating()
            && period.model.confirmed() != Some(true)
        {
            notices.add(at,"SEVEN_DAY_PLAN_UNCONFIRMED","Ein regelmäßiger Schicht- oder Wechselschichtdienstplan an sieben Wochentagen ist nicht bestätigt.",true)
        }
    }
    Ok(())
}

pub fn require_target_minutes(result: &MonthlyTarget) -> Result<i64, TargetError> {
    result.target_minutes.ok_or(TargetError::TargetUnavailable)
}
