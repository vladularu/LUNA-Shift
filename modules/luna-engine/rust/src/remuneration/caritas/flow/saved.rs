use super::*;
use std::collections::BTreeMap;
/// Native-only borrowed source view. Coverage is supplied by the native source assembler,
/// never decoded from transport Ready flags; there is deliberately no Deserialize implementation.
pub struct CatalogMonthSources<'a> {
    pub month: &'a str,
    pub work_profile: &'a Value,
    pub shifts: &'a [Value],
    pub pause_details: &'a [Value],
    pub entries_complete: bool,
    pub shift_entitlements: &'a [Value],
    pub work_day_confirmations: &'a [Value],
    pub remuneration_profiles: &'a [Value],
    pub month_facts: &'a [Value],
}
trait MonthSource {
    fn month(&self) -> Result<&str, FlowError>;
    fn work_profile(&self) -> &Value;
    fn array(&self, key: &str) -> Result<&[Value], FlowError>;
    fn entries_complete(&self) -> bool;
}
impl MonthSource for Value {
    fn month(&self) -> Result<&str, FlowError> {
        self["month"]
            .as_str()
            .ok_or_else(|| BaseError::InvalidCalculation.into())
    }
    fn work_profile(&self) -> &Value {
        &self["workProfile"]
    }
    fn array(&self, key: &str) -> Result<&[Value], FlowError> {
        self[key]
            .as_array()
            .map(Vec::as_slice)
            .ok_or_else(|| BaseError::InvalidCalculation.into())
    }
    fn entries_complete(&self) -> bool {
        js_truthy(&self["entriesComplete"])
    }
}
impl MonthSource for CatalogMonthSources<'_> {
    fn month(&self) -> Result<&str, FlowError> {
        Ok(self.month)
    }
    fn work_profile(&self) -> &Value {
        self.work_profile
    }
    fn array(&self, key: &str) -> Result<&[Value], FlowError> {
        Ok(match key {
            "shifts" => self.shifts,
            "pauseDetails" => self.pause_details,
            "shiftEntitlements" => self.shift_entitlements,
            "workDayConfirmations" => self.work_day_confirmations,
            "remunerationProfiles" => self.remuneration_profiles,
            "monthFacts" => self.month_facts,
            _ => return Err(BaseError::InvalidCalculation.into()),
        })
    }
    fn entries_complete(&self) -> bool {
        self.entries_complete
    }
}
pub fn from_saved(
    pkg: &RulePackage,
    input: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    saved_parts(
        pkg,
        input,
        input,
        input.array("dayDecisions")?,
        resolver,
        validator,
    )
}
fn saved_parts(
    pkg: &RulePackage,
    raw: &impl MonthSource,
    parameters_input: &Value,
    decisions: &[Value],
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    let month = raw.month()?;
    let profile = raw.work_profile();
    let zone = profile["timeZone"]
        .as_str()
        .ok_or(BaseError::InvalidCalculation)?;
    let work = work_slices::derive_month_work_slices(
        month,
        raw.array("shifts")?,
        raw.array("pauseDetails")?,
        zone,
        raw.entries_complete(),
    );
    if bad(&work) {
        return Ok(stage(work, "work-slices"));
    }
    let facts = work_facts::derive_work_facts_from_rules(
        pkg.rules(),
        rows(&work, "slices"),
        decisions,
        profile["federalState"]
            .as_str()
            .ok_or(BaseError::InvalidCalculation)?,
        profile["holidayRegion"]
            .as_str()
            .ok_or(BaseError::InvalidCalculation)?,
        resolver,
    )?;
    if bad(&facts) {
        return Ok(stage(facts, "holiday-facts"));
    }
    let mut args = parameters(parameters_input);
    args["month"] = json!(month);
    args["shiftEntitlements"] = json!(raw.array("shiftEntitlements")?);
    args["workedSlices"] = facts["slices"].clone();
    args["workDataComplete"] = json!(true);
    let value = calculate_month(pkg, &args, validator)?;
    Ok(if bad(&value) {
        stage(value, "pay")
    } else {
        value
    })
}
pub fn from_persisted(
    pkg: &RulePackage,
    input: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    persisted_parts(pkg, input, input, resolver, validator)
}
fn persisted_parts(
    pkg: &RulePackage,
    input: &impl MonthSource,
    parameters_input: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    let zone = input.work_profile()["timeZone"]
        .as_str()
        .ok_or(BaseError::InvalidCalculation)?;
    let shifts: BTreeMap<_, _> = input
        .array("shifts")?
        .iter()
        .map(|s| (s["id"].as_str().unwrap_or(""), s))
        .collect();
    let mut decisions = Vec::new();
    for saved in input.array("workDayConfirmations")? {
        let Some(shift) = shifts.get(saved["shiftId"].as_str().unwrap_or("")) else {
            continue;
        };
        if !super::super::saved::is_current_work_day(saved, shift, zone) {
            continue;
        }
        if !remuneration_shift_days(shift, zone)?
            .iter()
            .any(|d| saved["date"] == d.date)
        {
            continue;
        }
        decisions.push(json!({"shiftId":saved["shiftId"],"date":saved["date"],"origin":saved["origin"],"holidayTimeOff":saved["holidayTimeOff"],"shiftWork":saved["shiftWork"]}));
    }
    saved_parts(
        pkg,
        input,
        parameters_input,
        &decisions,
        resolver,
        validator,
    )
}
pub fn from_stored(
    pkg: &RulePackage,
    input: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    stored_source(pkg, input, resolver, validator)
}
fn stored_source(
    pkg: &RulePackage,
    input: &impl MonthSource,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    let month = input.month()?;
    let profile = match whole_profile(month, input.array("remunerationProfiles")?)? {
        Ok(p) => p,
        Err(reason) => return Ok(stage(unavailable(reason), "month-facts")),
    };
    let selection = &profile["data"]["selection"];
    if selection["packageId"] != pkg.package_id {
        return Ok(stage(
            unavailable("PROFILE_MISSING_OR_SPLIT"),
            "month-facts",
        ));
    }
    let facts = input
        .array("monthFacts")?
        .iter()
        .find(|f| f["month"] == month);
    let Some(facts) = facts.filter(|f| {
        super::super::saved::is_current_month(f, profile, &pkg.package_id, &pkg.version_id)
    }) else {
        return Ok(stage(
            unavailable("MONTH_FACTS_MISSING_OR_STALE"),
            "month-facts",
        ));
    };
    if facts["fullMonthEmploymentConfirmed"].is_null() {
        return Ok(stage(unavailable("EMPLOYMENT_UNKNOWN"), "month-facts"));
    }
    let args = json!({"month":month,"variantId":selection["variant"],"regionId":selection["region"],"groupId":selection["group"],"stepId":selection["level"],"weeklyMinutes":profile["data"]["weeklyMinutes"],"fullMonthEmploymentConfirmed":facts["fullMonthEmploymentConfirmed"],"fullMonthlyBaseEntitlementConfirmed":facts["fullMonthlyBaseEntitlementConfirmed"]==true,"fixedAllowanceClaim":facts["fixedAllowanceClaim"],"careAllowanceClaim":facts["careAllowanceClaim"],"localAgreement":facts["localAgreement"]});
    persisted_parts(pkg, input, &args, resolver, validator)
}
pub fn from_catalog(
    input: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    catalog_source(input, resolver, validator)
}
pub fn from_catalog_sources(
    input: &CatalogMonthSources<'_>,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    catalog_source(input, resolver, validator)
}
fn catalog_source(
    input: &impl MonthSource,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, FlowError> {
    let month = input.month()?;
    let profile = match whole_profile(month, input.array("remunerationProfiles")?)? {
        Ok(p) => p,
        Err(reason) => return Ok(stage(unavailable(reason), "month-facts")),
    };
    let id = profile["data"]["selection"]["packageId"]
        .as_str()
        .ok_or(BaseError::InvalidCalculation)?;
    let pkg = match resolver.resolve_tariff(&format!("{month}-01"), Some(id)) {
        Ok(pkg) => pkg,
        Err(e) => {
            return Ok(stage(
                unavailable(if e.code == "RULE_PACKAGE_AMBIGUOUS" {
                    "RULE_PACKAGE_AMBIGUOUS"
                } else {
                    "RULE_PACKAGE_MISSING"
                }),
                "rule-catalog",
            ));
        }
    };
    if !validator.validate(pkg).map_err(BaseError::from)?
        || pkg.kind != RuleKind::Tariff
        || pkg.package_id != id
        || pkg.engine_contract_version != 14
        || pkg.status() != Some("DRAFT")
    {
        return Ok(stage(unavailable("RULE_PACKAGE_INVALID"), "rule-catalog"));
    }
    stored_source(pkg, input, resolver, validator)
}
