//! Snapshot owners for native-validated confirmations. Views borrow original
//! evidence; even large per-day binding strings are never cloned or reparsed.
use super::{
    DraftFactsError, model::*, month::validate_saved_draft_confirmation,
    premium::validate_saved_annex_a_premium_facts,
};
use serde_json::Value;
use std::sync::Arc;

struct Identity {
    month: String,
    profile_effective_from: String,
    profile_revision: i64,
    package_id: String,
    rule_version_id: String,
    variant_id: String,
    region_id: String,
    group_id: String,
    step_id: String,
    contracted_weekly_minutes: i64,
    full_time: FullTimeReference,
    revision: i64,
    confirmed_at: String,
    updated_at: String,
}
impl Identity {
    fn new(value: ConfirmationIdentity<'_>) -> Self {
        Self {
            month: value.month,
            profile_effective_from: value.profile_effective_from.into(),
            profile_revision: value.profile_revision,
            package_id: value.package_id.into(),
            rule_version_id: value.rule_version_id.into(),
            variant_id: value.variant_id.into(),
            region_id: value.region_id.into(),
            group_id: value.group_id.into(),
            step_id: value.step_id.into(),
            contracted_weekly_minutes: value.contracted_weekly_minutes,
            full_time: value.full_time,
            revision: value.revision,
            confirmed_at: value.confirmed_at.into(),
            updated_at: value.updated_at.into(),
        }
    }
    fn view(&self) -> ConfirmationIdentity<'_> {
        ConfirmationIdentity {
            month: self.month.clone(),
            profile_effective_from: &self.profile_effective_from,
            profile_revision: self.profile_revision,
            package_id: &self.package_id,
            rule_version_id: &self.rule_version_id,
            variant_id: &self.variant_id,
            region_id: &self.region_id,
            group_id: &self.group_id,
            step_id: &self.step_id,
            contracted_weekly_minutes: self.contracted_weekly_minutes,
            full_time: self.full_time.clone(),
            revision: self.revision,
            confirmed_at: &self.confirmed_at,
            updated_at: &self.updated_at,
        }
    }
}
fn bound(rows: &[Value]) -> Result<(), DraftFactsError> {
    if rows.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
        return Err(DraftFactsError::Message(
            "Zu viele gespeicherte Bestätigungen.",
        ));
    }
    Ok(())
}
/// Only its constructor performs admission. There is no Deserialize or raw
/// Value-to-ready conversion; raw() retains the immutable source identity.
pub struct DraftConfirmationOwner {
    raw: Arc<Vec<Value>>,
    rows: Vec<(Identity, ConfirmationAnswers)>,
    kind: ConfirmationKind,
}
impl DraftConfirmationOwner {
    pub fn new(kind: ConfirmationKind, raw: Arc<Vec<Value>>) -> Result<Self, DraftFactsError> {
        bound(&raw)?;
        let rows = raw
            .iter()
            .map(|raw| {
                let value = validate_saved_draft_confirmation(raw, kind)?;
                Ok((Identity::new(value.identity), value.answers))
            })
            .collect::<Result<Vec<_>, DraftFactsError>>()?;
        Ok(Self { raw, rows, kind })
    }
    pub fn raw(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn kind(&self) -> ConfirmationKind {
        self.kind
    }
    /// Build once per provider; the same views serve all requested months.
    pub fn views(&self) -> Vec<SavedDraftConfirmation<'_>> {
        self.rows
            .iter()
            .map(|(identity, answers)| SavedDraftConfirmation {
                identity: identity.view(),
                answers: answers.clone(),
            })
            .collect()
    }
}
struct Day {
    date: String,
    work_kind: Option<WorkKind>,
    holiday_time_off: Option<bool>,
    shift_work: Option<bool>,
    legacy_angestellte_class: Option<bool>,
}
struct Premium {
    identity: Identity,
    cash_payment_confirmed: Option<bool>,
    local_agreement: LocalAgreement,
    days: Vec<Day>,
}
pub struct AnnexPremiumOwner {
    raw: Arc<Vec<Value>>,
    rows: Vec<Premium>,
}
impl AnnexPremiumOwner {
    pub fn new(raw: Arc<Vec<Value>>) -> Result<Self, DraftFactsError> {
        bound(&raw)?;
        let rows = raw
            .iter()
            .map(|raw| {
                let value = validate_saved_annex_a_premium_facts(raw)?;
                Ok(Premium {
                    identity: Identity::new(value.identity),
                    cash_payment_confirmed: value.cash_payment_confirmed,
                    local_agreement: value.local_agreement,
                    days: value
                        .day_decisions
                        .into_iter()
                        .map(|day| Day {
                            date: day.date,
                            work_kind: day.work_kind,
                            holiday_time_off: day.holiday_time_off,
                            shift_work: day.shift_work,
                            legacy_angestellte_class: day.legacy_angestellte_class,
                        })
                        .collect(),
                })
            })
            .collect::<Result<Vec<_>, DraftFactsError>>()?;
        Ok(Self { raw, rows })
    }
    pub fn raw(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    /// No full binding string or raw day object is cloned. All indexed field
    /// reads are protected by new() and exclusive ownership of the checked Arc.
    pub fn views(&self) -> Vec<SavedPremiumFacts<'_>> {
        self.rows
            .iter()
            .zip(self.raw.iter())
            .map(|(row, raw)| {
                let days = raw["dayDecisions"]
                    .as_array()
                    .expect("checked premium days");
                SavedPremiumFacts {
                    identity: row.identity.view(),
                    time_zone_id: "Europe/Berlin",
                    cash_payment_confirmed: row.cash_payment_confirmed,
                    local_agreement: row.local_agreement,
                    day_decisions: row
                        .days
                        .iter()
                        .zip(days)
                        .map(|(day, raw)| DayDecision {
                            shift_id: raw["shiftId"].as_str().expect("checked premium shift"),
                            date: day.date.clone(),
                            origin: "confirmed",
                            shift_binding: raw["shiftBinding"]
                                .as_str()
                                .expect("checked premium binding"),
                            work_kind: day.work_kind,
                            holiday_time_off: day.holiday_time_off,
                            shift_work: day.shift_work,
                            legacy_angestellte_class: day.legacy_angestellte_class,
                        })
                        .collect(),
                    original_day_decisions: days,
                }
            })
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_premium_views_borrow_original_binding_strings_and_raw_day_objects() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../reference/annex-premium-facts-golden.json"
        ))
        .unwrap();
        for case in corpus["cases"].as_array().unwrap() {
            let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
            let value = &input["value"];
            if value["dayDecisions"].as_array().is_none_or(Vec::is_empty) {
                continue;
            }
            let raw = Arc::new(vec![value.clone()]);
            let Ok(owner) = AnnexPremiumOwner::new(Arc::clone(&raw)) else {
                continue;
            };
            assert!(Arc::ptr_eq(owner.raw(), &raw));
            let first = owner.views();
            let second = owner.views();
            let original = raw[0]["dayDecisions"].as_array().unwrap();
            assert!(std::ptr::eq(
                first[0].original_day_decisions,
                original.as_slice()
            ));
            for (index, original) in original.iter().enumerate() {
                let binding = original["shiftBinding"].as_str().unwrap();
                assert_eq!(
                    first[0].day_decisions[index].shift_binding.as_ptr(),
                    binding.as_ptr()
                );
                assert_eq!(
                    second[0].day_decisions[index].shift_binding.as_ptr(),
                    binding.as_ptr()
                );
            }
            return;
        }
        panic!("source corpus must contain valid bound work evidence");
    }
}
