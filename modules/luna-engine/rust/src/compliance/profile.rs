//! Complete effective profile bases. Saved target contexts stay borrowed and lossless.
use super::model::ComplianceError;
use crate::employment::profile_view::EmploymentProfileRef;
use serde_json::Value;
#[derive(Clone, Copy)]
enum Basis<'a> {
    Original(&'a Value),
    Effective(EmploymentProfileRef<'a>),
}
#[derive(Clone, Copy)]
pub struct ComplianceProfile<'a> {
    basis: Basis<'a>,
}
impl<'a> ComplianceProfile<'a> {
    pub fn from_raw(profile: &'a Value) -> Self {
        Self {
            basis: Basis::Original(profile),
        }
    }
    pub fn at(profile: &'a Value, date: &str) -> Result<Self, ComplianceError> {
        Ok(Self {
            basis: Basis::Effective(EmploymentProfileRef::at(profile, date)?),
        })
    }
    pub fn get(&self, key: &str) -> Option<&'a Value> {
        match self.basis {
            Basis::Original(profile) => profile.get(key),
            Basis::Effective(profile) => profile.get(key),
        }
    }
    pub(super) fn fields_at(self, date: &str) -> Result<ProfileFields<'a>, ComplianceError> {
        Ok(ProfileFields {
            base: self,
            overlay: crate::employment::employment_overlay_from_fields(
                self.get("salaryBasisConflict"),
                self.get("employmentTimeline"),
                date,
            )?,
        })
    }
    pub(super) fn periods(
        self,
        month: &str,
        last_day: &str,
    ) -> Result<Vec<crate::employment::EmploymentMonthBoundary>, ComplianceError> {
        Ok(crate::employment::employment_month_boundaries_from_fields(
            self.get("employmentTimeline"),
            month,
            last_day,
        )?)
    }
    fn original(self) -> &'a Value {
        match self.basis {
            Basis::Original(v) => v,
            Basis::Effective(v) => v.original(),
        }
    }
    pub(super) fn is_null(self) -> bool {
        self.original().is_null()
    }
    pub(super) fn truthy(self) -> bool {
        crate::credit::summary::truthy(Some(self.original()))
    }
}
#[derive(Clone, Copy)]
pub(super) struct ProfileFields<'a> {
    base: ComplianceProfile<'a>,
    overlay: Option<&'a Value>,
}
impl<'a> ProfileFields<'a> {
    pub fn get(self, key: &str) -> Option<&'a Value> {
        self.overlay
            .and_then(|overlay| overlay.get(key))
            .or_else(|| self.base.get(key))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_partial_snapshots_fall_back_to_the_selected_basis_not_the_original_profile() {
        let reference: Value = serde_json::from_str(include_str!(
            "../../../reference/compliance-profile-golden.json"
        ))
        .unwrap();
        let rows = reference["projections"].as_array().unwrap();
        assert_eq!(rows.len(), 8);
        for row in rows {
            let input: Value = serde_json::from_str(row["inputJson"].as_str().unwrap()).unwrap();
            let basis =
                ComplianceProfile::at(&input["profile"], input["basisDate"].as_str().unwrap())
                    .unwrap();
            let fields = basis.fields_at(input["date"].as_str().unwrap()).unwrap();
            let mut actual = serde_json::Map::new();
            for key in [
                "federalState",
                "holidayRegion",
                "timeZone",
                "weeklyMinutes",
                "regularRotatingNightWork",
                "sundayHolidayWorkEligible",
                "allEmploymentWorkRecorded",
                "tariff",
                "workPattern",
            ] {
                if let Some(value) = fields.get(key) {
                    actual.insert(key.into(), value.clone());
                }
            }
            assert_eq!(Value::Object(actual), row["expected"]);
        }
    }
}
