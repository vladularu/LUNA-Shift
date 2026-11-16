use crate::input::InputError;
use serde::Serialize;
use serde_json::{Map, Value, json};
pub const WORK_COLUMNS: &[&str] = &[
    "federal_state",
    "holiday_region",
    "weekly_minutes",
    "time_zone",
    "pay_group",
    "pay_level",
    "tariff_sector",
    "tariff_region",
    "full_time_weekly_minutes",
    "industry",
    "manual_monthly_gross_cents",
    "regular_rotating_night_work",
    "sunday_holiday_work_eligible",
    "all_employment_work_recorded",
    "display_name",
    "employer_name",
    "created_at",
    "updated_at",
];
#[derive(Debug, Serialize)]
pub enum PreferenceWrite {
    Upsert {
        key: &'static str,
        value: String,
        updated_at: String,
    },
    Delete {
        key: &'static str,
    },
}
#[derive(Debug, Serialize)]
pub struct ProfileStorageRows {
    pub work: Value,
    pub preferences: Vec<PreferenceWrite>,
}
impl ProfileStorageRows {
    pub fn reference_json(&self) -> Value {
        json!({"row":WORK_COLUMNS.iter().map(|key|self.work[*key].clone()).collect::<Vec<_>>(),"preferences":self.preferences.iter().map(|value|match value{PreferenceWrite::Upsert{key,value,updated_at}=>json!({"kind":"UPSERT","args":[key,value,updated_at]}),PreferenceWrite::Delete{key}=>json!({"kind":"DELETE","args":[key]})}).collect::<Vec<_>>()})
    }
}
pub fn profile_rows(profile: &Value, now: &str) -> Result<ProfileStorageRows, InputError> {
    let profile = crate::input::profile::validate_profile(profile)?;
    let tariff = &profile["tariff"];
    let boolean = |key: &str| {
        if profile[key].is_null() {
            Value::Null
        } else {
            json!(i64::from(crate::net::js_truthy(&profile[key])))
        }
    };
    let values = vec![
        profile["federalState"].clone(),
        profile["holidayRegion"].clone(),
        profile["weeklyMinutes"].clone(),
        profile["timeZone"].clone(),
        tariff["payGroup"].clone(),
        tariff["payLevel"].clone(),
        tariff["sector"].clone(),
        tariff
            .get("tariffRegion")
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or_else(|| json!("OTHER")),
        tariff["fullTimeWeeklyMinutes"].clone(),
        profile["industry"].clone(),
        profile["manualMonthlyGrossCents"].clone(),
        boolean("regularRotatingNightWork"),
        boolean("sundayHolidayWorkEligible"),
        boolean("allEmploymentWorkRecorded"),
        profile["displayName"].clone(),
        profile["employerName"].clone(),
        json!(now),
        json!(now),
    ];
    let work = Value::Object(
        WORK_COLUMNS
            .iter()
            .zip(values)
            .map(|(key, value)| ((*key).into(), value))
            .collect::<Map<_, _>>(),
    );
    let mut preferences = vec![];
    for (key, field) in [
        ("salary_nursing_training", "nursingTrainingTariff"),
        ("salary_vka_e", "vkaETariff"),
        ("salary_tvl_kr", "tvlKrTariff"),
        ("salary_tvuk_nursing", "tvUkNursingTariff"),
        ("simpleSalary.tvhKr", "tvhKrTariff"),
        ("salary_tval_pflege", "tvalPflegeTariff"),
    ] {
        if crate::net::js_truthy(&profile[field]) {
            preferences.push(PreferenceWrite::Upsert {
                key,
                value: crate::input::javascript_json::stringify(&profile[field])
                    .map_err(|_| super::invalid())?,
                updated_at: now.into(),
            });
        } else {
            preferences.push(PreferenceWrite::Delete { key });
        }
    }
    Ok(ProfileStorageRows { work, preferences })
}
