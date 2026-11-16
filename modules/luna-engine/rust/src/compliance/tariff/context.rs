//! Dated legal tariff scope is separate from a monetary table selection.
use super::policy;
use crate::compliance::{
    average::add_days,
    holiday_coverage::truthy,
    model::{ComplianceError, text},
    profile::ComplianceProfile,
};
use crate::{calendar::parse_date, employment};
use serde_json::{Value, json};
pub(crate) const SALARY_BASIS_KEYS: [&str; 8] = [
    "tariff",
    "manualMonthlyGrossCents",
    "nursingTrainingTariff",
    "vkaETariff",
    "tvlKrTariff",
    "tvUkNursingTariff",
    "tvhKrTariff",
    "tvalPflegeTariff",
];
/// Exact source `!= null`: zero, false and empty objects are still distinct bases.
pub(crate) fn salary_basis_count<'a>(field: impl Fn(&str) -> Option<&'a Value>) -> usize {
    SALARY_BASIS_KEYS
        .iter()
        .filter(|key| field(key).is_some_and(|v| !v.is_null()))
        .count()
}
pub fn salary_basis_count_value(profile: &Value) -> usize {
    salary_basis_count(|key| profile.get(key))
}
#[derive(Clone, Copy)]
enum Candidate {
    None,
    Missing,
    Family {
        family: &'static str,
        training: bool,
        missing_employer: bool,
    },
}
impl Candidate {
    fn family(family: &'static str, training: bool) -> Self {
        Self::Family {
            family,
            training,
            missing_employer: false,
        }
    }
}
fn from_target(v: &Value) -> Candidate {
    match v.get("kind").and_then(Value::as_str) {
        Some("TVOED_K") => Candidate::family("TVOED_K", false),
        Some("TVOED_B") => Candidate::family("TVOED_B", false),
        Some("TVL_KR") => Candidate::family("TVL_KR", false),
        Some("TVH_KR") => Candidate::family("TVH_KR", false),
        Some("TVUK_NURSING") => Candidate::family("TVUK", false),
        Some("TVAOED_K") => Candidate::family("TVOED_K", true),
        Some("TVAOED_B") => Candidate::family("TVOED_B", true),
        Some("TVAL_KR") => Candidate::family("TVL_KR", true),
        Some("TVAL_GENERAL") => Candidate::family("TVL_GENERAL", true),
        Some("TVAL_COMMON") => Candidate::Family {
            family: "TVL_GENERAL",
            training: true,
            missing_employer: true,
        },
        Some("CUSTOM") => Candidate::None,
        _ => Candidate::Missing,
    }
}
fn from_selection(v: &Value) -> Candidate {
    if v.get("kind").and_then(Value::as_str) != Some("tariff") {
        return Candidate::None;
    }
    match v.get("packageId").and_then(Value::as_str) {
        Some("tvoed-vka-bt-k" | "tvoed-p-vka-legacy" | "tvaoed-pflege-vka") => {
            let training = v["packageId"] == "tvaoed-pflege-vka";
            match v.get("variant").and_then(Value::as_str) {
                Some("BT_B") => Candidate::family("TVOED_B", training),
                Some("BT_K") => Candidate::family("TVOED_K", training),
                _ => Candidate::Missing,
            }
        }
        Some("tvl-kr-tdl") => Candidate::family("TVL_KR", false),
        Some("tval-pflege-tdl") => Candidate::Family {
            family: if v.get("tvalEmployerScope").and_then(Value::as_str) == Some("SECTION_43") {
                "TVL_KR"
            } else {
                "TVL_GENERAL"
            },
            training: true,
            missing_employer: v.get("tvalEmployerScope").is_none_or(Value::is_null),
        },
        _ => Candidate::Missing,
    }
}
fn from_profile<'a>(field: impl Fn(&str) -> Option<&'a Value>) -> Candidate {
    for (key, family, training) in [
        ("tariff", "TVOED_K", false),
        ("vkaETariff", "TVOED_K", false),
        ("tvlKrTariff", "TVL_KR", false),
        ("tvhKrTariff", "TVH_KR", false),
        ("tvUkNursingTariff", "TVUK", false),
        ("nursingTrainingTariff", "TVOED_K", true),
        ("tvalPflegeTariff", "TVL_GENERAL", true),
    ] {
        if let Some(v) = field(key).filter(|v| truthy(v)) {
            if key == "tvalPflegeTariff" {
                return Candidate::Family {
                    family: if v.get("employerScope").and_then(Value::as_str) == Some("SECTION_43")
                    {
                        "TVL_KR"
                    } else {
                        "TVL_GENERAL"
                    },
                    training: true,
                    missing_employer: v.get("employerScope").is_none_or(Value::is_null),
                };
            }
            return Candidate::family(
                if matches!(key, "tariff" | "vkaETariff" | "nursingTrainingTariff")
                    && v.get("sector").and_then(Value::as_str) == Some("BT_B")
                {
                    "TVOED_B"
                } else {
                    family
                },
                training,
            );
        }
    }
    Candidate::None
}
pub struct TariffTimeContext {
    pub(super) policy: Option<&'static Value>,
    pub(super) label: String,
    pub(super) scope_confirmed: bool,
    pub(super) unavailable: bool,
    pub(super) requirements: Vec<String>,
    pub(super) sunday_eligible: Option<Value>,
    pub(super) sunday_model_known: bool,
    pub(super) key: String,
    training: bool,
    unavailable_reason: Option<&'static str>,
}
impl TariffTimeContext {
    pub fn to_json(&self) -> Value {
        let mut out = json!({"policy":self.policy,"label":self.label,"training":self.training,"scopeConfirmed":self.scope_confirmed,"unavailable":self.unavailable,"unavailableReason":self.unavailable_reason,"requirements":self.requirements,"sundayWorkModelKnown":self.sunday_model_known,"key":self.key});
        if let Some(v) = &self.sunday_eligible {
            out["sundayHolidayWorkEligible"] = v.clone();
        }
        out
    }
}
pub fn tariff_context_at(
    profile: &Value,
    date: &str,
) -> Result<Option<TariffTimeContext>, ComplianceError> {
    tariff_context_for_basis(ComplianceProfile::from_raw(profile), date)
}
pub(super) fn tariff_context_for_basis(
    profile: ComplianceProfile<'_>,
    date: &str,
) -> Result<Option<TariffTimeContext>, ComplianceError> {
    let fields = profile.fields_at(date)?;
    let field = |key: &str| fields.get(key);
    let mut requirements = vec![];
    let mut scope_confirmed = false;
    let mut scope_excluded = false;
    let mut conflict = false;
    let mut boundaries = json!(["1900-01-01", null, null, null]);
    let candidate = if field("salaryBasisConflict").is_some_and(truthy)
        || salary_basis_count(field) > 1
    {
        conflict = true;
        requirements.push("Wähle eine eindeutige Tarifgrundlage für diesen Zeitraum.".into());
        Candidate::Missing
    } else {
        let mut candidate = Candidate::Missing;
        if let Some(target) = profile.get("workingTimeTarget") {
            if target.get("status").and_then(Value::as_str) != Some("ready") {
                requirements.push(if target.get("status").and_then(Value::as_str)==Some("loading"){"Die Arbeitszeit-Tarifgrundlage wird noch geladen."}else{"Die Arbeitszeit-Tarifgrundlage konnte nicht geladen werden. Bitte prüfe die Arbeitszeitdaten."}.into());
            } else if let Some(context) = target.get("context").filter(|v| truthy(v)) {
                let employment = context.get("employment").filter(|v| truthy(v));
                let periods = context
                    .get("periods")
                    .and_then(Value::as_array)
                    .ok_or(ComplianceError::InvalidInput)?;
                let matches = periods
                    .iter()
                    .filter(|p| {
                        p.get("validFrom")
                            .and_then(Value::as_str)
                            .is_some_and(|v| v <= date)
                            && (p.get("validTo") == Some(&Value::Null)
                                || p.get("validTo")
                                    .and_then(Value::as_str)
                                    .is_some_and(|v| v >= date))
                    })
                    .collect::<Vec<_>>();
                if employment.is_some_and(|e| {
                    e.get("from")
                        .and_then(Value::as_str)
                        .is_some_and(|v| date < v)
                        || e.get("to")
                            .and_then(Value::as_str)
                            .is_some_and(|v| date > v)
                }) {
                    requirements.push("Die erfassten Dienste liegen außerhalb des hinterlegten Beschäftigungszeitraums.".into());
                } else if matches.len() != 1 {
                    requirements.push(if matches.is_empty(){"Die vorhandenen Arbeitszeit-Tarifzeiträume decken dieses Datum nicht ab."}else{"Mehrere Arbeitszeit-Tarifzeiträume gelten zugleich. Die Zuordnung ist zu klären."}.into());
                } else {
                    let p = matches[0];
                    let tariff = &p["tariff"];
                    candidate = from_target(tariff);
                    if tariff["kind"] == "UNVERIFIED"
                        && matches!(
                            tariff.get("id").and_then(Value::as_str),
                            Some("OWN_OR_UNCONFIGURED" | "CURRENT_SALARY_SELECTION")
                        )
                    {
                        candidate = from_profile(field);
                    }
                    scope_confirmed = target.get("mode").and_then(Value::as_str)
                        != Some("FORECAST")
                        && tariff.get("scopeConfirmed") == Some(&Value::Bool(true));
                    scope_excluded = tariff.get("scopeConfirmed") == Some(&Value::Bool(false));
                    boundaries = json!([
                        p["validFrom"],
                        p["validTo"],
                        employment.and_then(|e| e.get("from")),
                        employment.and_then(|e| e.get("to"))
                    ]);
                }
            } else {
                requirements.push(
                    "Für die bereitgestellten Arbeitszeitdaten ist kein Tarifzeitraum verfügbar."
                        .into(),
                );
            }
        } else {
            let history = profile
                .get("employmentTimeline")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let dated = if history.is_empty() {
                None
            } else {
                employment::resolve_remuneration_profile_ref(history, date)?.profile
            };
            candidate =
                if let Some(dated) = dated.filter(|p| !p.get("employment").is_some_and(truthy)) {
                    from_selection(&dated["data"]["selection"])
                } else {
                    from_profile(field)
                };
            if let Some(dated) = dated {
                let next = history
                    .iter()
                    .filter_map(|p| p.get("effectiveFrom").and_then(Value::as_str))
                    .filter(|d| *d > date)
                    .min();
                let next = next
                    .map(|v| add_days(parse_date(v)?, -1).map(|d| d.to_string()))
                    .transpose()?;
                boundaries = json!([
                    dated
                        .get("effectiveFrom")
                        .and_then(Value::as_str)
                        .unwrap_or("1900-01-01"),
                    next,
                    null,
                    null
                ]);
            }
        }
        if matches!(candidate, Candidate::Missing) {
            requirements.push(
                "Die Tarifzuordnung ist für diesen Zeitraum nicht hinreichend bestimmt.".into(),
            );
        }
        candidate
    };
    if matches!(candidate, Candidate::None) {
        return Ok(None);
    }
    let (family, training, missing_employer) = match candidate {
        Candidate::Family {
            family,
            training,
            missing_employer,
        } => (
            Some(if training {
                match family {
                    "TVOED_K" => "TVAOED_K",
                    "TVOED_B" => "TVAOED_B",
                    "TVL_KR" => "TVAL_KR",
                    "TVL_GENERAL" => "TVAL_GENERAL",
                    other => other,
                }
            } else {
                family
            }),
            training,
            missing_employer,
        ),
        _ => (None, false, false),
    };
    let policy = family.and_then(policy::family);
    let reviewed = date >= text(&policy::data()["review"], "from")?
        && date <= text(&policy::data()["review"], "until")?;
    if !reviewed {
        requirements.push(
            "Die Tarifregeln sind für diesen Zeitraum noch nicht in dieser Prüffassung geprüft."
                .into(),
        );
    }
    if missing_employer {
        requirements.push("Der Beschäftigtentarif des Ausbildenden ist noch zu bestätigen.".into());
    }
    if scope_excluded {
        requirements.push("Der Geltungsbereich wurde in den Arbeitszeitdaten ausgeschlossen; die Tarifzuordnung ist zu klären.".into());
    }
    if training {
        requirements.push("Alter, Schulzeiten und der Beschäftigtentarif des Ausbildenden sind für die Ausbildungsprüfung zu bestätigen.".into());
    }
    if family == Some("TVH_KR") {
        requirements.push("Die Zuordnung zum Krankenpflegedienst im Justizvollzug und der abschließende ÄTV-25-Abgleich bleiben zu prüfen.".into());
    }
    let unavailable =
        matches!(candidate, Candidate::Missing) || !reviewed || missing_employer || scope_excluded;
    let unavailable_reason = if conflict {
        Some("CONFLICT")
    } else if !reviewed {
        Some("COVERAGE")
    } else if unavailable {
        Some("SCOPE")
    } else {
        None
    };
    let sunday_eligible = field("sundayHolidayWorkEligible").cloned();
    let pattern = field("workPattern").filter(|v| !v.is_null());
    let sunday_model_known = sunday_eligible == Some(Value::Bool(true))
        || (sunday_eligible != Some(Value::Bool(false))
            && pattern.is_some_and(|p| {
                p["workplaceCoverage"] == "AROUND_THE_CLOCK" && p["assignment"] == "PERMANENT"
            }));
    let key = serde_json::to_string(&json!([
        family,
        training,
        scope_confirmed,
        unavailable,
        requirements,
        sunday_eligible,
        pattern,
        boundaries
    ]))
    .map_err(|_| ComplianceError::InvalidInput)?;
    Ok(Some(TariffTimeContext {
        policy,
        label: policy
            .and_then(|p| p["label"].as_str())
            .unwrap_or("Tarifvertrag")
            .into(),
        training,
        scope_confirmed,
        unavailable,
        unavailable_reason,
        requirements,
        sunday_eligible,
        sunday_model_known,
        key,
    }))
}
