//! Raw form policy. Drafts are checked settings, never a host-provided net result.
use super::{InputError, trim_javascript};
use crate::{
    calendar::parse_date,
    net::{
        automation::pension_max_own_rate,
        settings::{SettingsError, validate_monthly_net_pay_settings},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetFormState {
    birth_date: String,
    tax_class: Option<f64>,
    factor_mode: Option<String>,
    factor: String,
    church_tax_rate: Option<f64>,
    child_allowance: String,
    is_parent: Option<bool>,
    children_under25: String,
    works_in_saxony: Option<bool>,
    health_additional_rate: String,
    monthly_tax_allowance: String,
    special_cases: Option<Vec<String>>,
    sfn_basic_hourly_pay: String,
}

impl NetFormState {
    /// Every nullable field is required; missing and explicit null are distinct.
    /// Unrelated additional fields are ignored, as in the original form helper.
    pub fn try_from_raw(raw: &Value) -> Result<Self, InputError> {
        let keys = [
            "birthDate",
            "taxClass",
            "factorMode",
            "factor",
            "churchTaxRate",
            "childAllowance",
            "isParent",
            "childrenUnder25",
            "worksInSaxony",
            "healthAdditionalRate",
            "monthlyTaxAllowance",
            "specialCases",
            "sfnBasicHourlyPay",
        ];
        if !raw
            .as_object()
            .is_some_and(|v| keys.iter().all(|key| v.contains_key(*key)))
        {
            return Err(shape_error());
        }
        let text = |key: &str| raw[key].as_str().map(str::to_owned).ok_or_else(shape_error);
        Ok(Self {
            birth_date: text("birthDate")?,
            tax_class: nullable(&raw["taxClass"], Value::as_f64)?,
            factor_mode: nullable(&raw["factorMode"], |v| v.as_str().map(str::to_owned))?,
            factor: text("factor")?,
            church_tax_rate: nullable(&raw["churchTaxRate"], Value::as_f64)?,
            child_allowance: text("childAllowance")?,
            is_parent: nullable(&raw["isParent"], Value::as_bool)?,
            children_under25: text("childrenUnder25")?,
            works_in_saxony: nullable(&raw["worksInSaxony"], Value::as_bool)?,
            health_additional_rate: text("healthAdditionalRate")?,
            monthly_tax_allowance: text("monthlyTaxAllowance")?,
            special_cases: nullable(&raw["specialCases"], |v| {
                v.as_array()?
                    .iter()
                    .map(|s| s.as_str().map(str::to_owned))
                    .collect()
            })?,
            sfn_basic_hourly_pay: text("sfnBasicHourlyPay")?,
        })
    }
}
fn error(message: impl Into<String>) -> InputError {
    InputError::source(message, "Error")
}
fn shape_error() -> InputError {
    error("Die Formularfelder sind unvollständig oder ungültig.")
}
fn nullable<T>(
    value: &Value,
    read: impl FnOnce(&Value) -> Option<T>,
) -> Result<Option<T>, InputError> {
    if value.is_null() {
        Ok(None)
    } else {
        read(value).map(Some).ok_or_else(shape_error)
    }
}
fn settings_error(source: SettingsError) -> InputError {
    let name = if matches!(source, SettingsError::Profile) {
        "NetPayProfileValidationError"
    } else {
        "Error"
    };
    InputError::source(source.to_string(), name)
}

#[derive(Debug)]
pub struct InitialNetSettings(Value);
impl InitialNetSettings {
    pub fn try_from_raw(raw: &Value) -> Result<Self, InputError> {
        validate_monthly_net_pay_settings(raw)
            .map(Self)
            .map_err(settings_error)
    }
    pub fn settings(&self) -> &Value {
        &self.0
    }
}

#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct ValidatedNetDraft(Value);
impl ValidatedNetDraft {
    pub fn settings(&self) -> &Value {
        &self.0
    }
    pub fn into_settings(self) -> Value {
        self.0
    }
}

#[derive(Debug, Clone, Copy)]
pub enum DecimalScale {
    Units,
    Cents,
    Permille,
}

/// Exact for the three scales used by these forms; entered fractions never round.
pub fn parse_decimal(text: &str, scale: DecimalScale, label: &str) -> Result<i64, InputError> {
    let (factor, places) = match scale {
        DecimalScale::Units => (1, 0),
        DecimalScale::Cents => (100, 2),
        DecimalScale::Permille => (1000, 3),
    };
    let syntax = || {
        error(format!(
            "Bitte {label} vollständig und ohne Tausendertrennzeichen angeben."
        ))
    };
    let range = || error(format!("Bitte einen gültigen Wert für {label} angeben."));
    let text = trim_javascript(text);
    let mut parts = text.split([',', '.']);
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    if whole.is_empty()
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || parts.next().is_some()
        || fraction.is_some_and(|v| {
            v.is_empty() || v.len() > places || !v.bytes().all(|c| c.is_ascii_digit())
        })
    {
        return Err(syntax());
    }
    // Accepted values are <=10M; preserve arbitrarily many leading zeroes but
    // cap before multiplying instead of parsing an unbounded raw integer.
    let mut whole_value = 0_i64;
    for byte in whole.bytes() {
        whole_value = whole_value
            .checked_mul(10)
            .and_then(|v| v.checked_add(i64::from(byte - b'0')))
            .ok_or_else(range)?;
        if whole_value > 10_000_000 {
            return Err(range());
        }
    }
    let mut fractional = 0_i64;
    for index in 0..places {
        fractional = fractional * 10
            + i64::from(
                fraction
                    .and_then(|v| v.as_bytes().get(index))
                    .copied()
                    .unwrap_or(b'0')
                    - b'0',
            );
    }
    let amount = whole_value * factor + fractional;
    if amount > 10_000_000 {
        return Err(range());
    }
    Ok(amount)
}
pub(crate) fn display_decimal(value: f64, scale: f64) -> String {
    // Bounded integer settings / 100 or / 1000: original shortest Number display,
    // without using a floating-point shortcut for input money calculations.
    (value / scale).to_string().replace('.', ",")
}
pub fn form_values(initial: Option<&InitialNetSettings>) -> Result<NetFormState, InputError> {
    let Some(initial) = initial else {
        return NetFormState::try_from_raw(
            &json!({"birthDate":"","taxClass":null,"factorMode":null,"factor":"","churchTaxRate":null,"childAllowance":"","isParent":null,"childrenUnder25":"","worksInSaxony":null,"healthAdditionalRate":"","monthlyTaxAllowance":"","specialCases":null,"sfnBasicHourlyPay":""}),
        );
    };
    let settings = initial.settings();
    let p = &settings["profile"];
    let number = |key: &str| p[key].as_f64().ok_or_else(shape_error);
    let birth = p["birthDate"].as_str().ok_or_else(shape_error)?;
    let factor = p["factorPermille"].as_f64();
    let sfn = settings["sfnBasicHourlyPayCents"].as_f64();
    NetFormState::try_from_raw(&json!({
        "birthDate":format!("{}.{}.{}",&birth[8..],&birth[5..7],&birth[..4]),
        "taxClass":p["taxClass"],"factorMode":if factor.is_none(){"NONE"}else{"FACTOR"},
        "factor":factor.filter(|v|*v!=0.0).map(|v|display_decimal(v,1000.0)).unwrap_or_default(),
        "churchTaxRate":p["churchTaxRatePercent"],
        "childAllowance":display_decimal(number("childAllowanceHalfUnits")?*50.0,100.0),
        "isParent":p["isParent"],"childrenUnder25":number("childrenUnder25")?.to_string(),
        "worksInSaxony":p["worksInSaxony"],
        "healthAdditionalRate":display_decimal(number("healthAdditionalRateBps")?,100.0),
        "monthlyTaxAllowance":display_decimal(number("monthlyTaxAllowanceCents")?,100.0),
        "specialCases":settings["specialCases"],
        "sfnBasicHourlyPay":sfn.map(|v|display_decimal(v,100.0)).unwrap_or_default()
    }))
}
pub fn setup_values(
    initial: Option<&InitialNetSettings>,
    works_in_saxony: bool,
) -> Result<NetFormState, InputError> {
    let mut form = form_values(initial)?;
    form.factor_mode = Some(
        if initial.is_some_and(|v| {
            v.settings()["profile"]["factorPermille"]
                .as_f64()
                .is_some_and(|f| f != 0.0)
        }) {
            "FACTOR"
        } else {
            "NONE"
        }
        .to_owned(),
    );
    if initial.is_none() {
        form.child_allowance = "0".to_owned();
        form.children_under25 = "0".to_owned();
        form.health_additional_rate = HEALTH_FORECAST_RATE.to_owned();
        form.monthly_tax_allowance = "0".to_owned();
        form.special_cases = Some(vec![]);
    }
    form.works_in_saxony = Some(works_in_saxony);
    form.sfn_basic_hourly_pay.clear();
    Ok(form)
}
pub fn prepare_monthly(month: &str, form: &NetFormState) -> Result<ValidatedNetDraft, InputError> {
    if month.len() != 7 || parse_date(&format!("{month}-01")).is_err() {
        return Err(error("Der Abrechnungsmonat ist ungültig."));
    }
    let birth = trim_javascript(&form.birth_date);
    if birth.len() != 10
        || birth.as_bytes()[2] != b'.'
        || birth.as_bytes()[5] != b'.'
        || birth
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 2 && i != 5 && !b.is_ascii_digit())
    {
        return Err(error("Bitte das Geburtsdatum als TT.MM.JJJJ angeben."));
    }
    let birth_date = format!("{}-{}-{}", &birth[6..], &birth[3..5], &birth[..2]);
    let date =
        parse_date(&birth_date).map_err(|_| error("Bitte ein gültiges Geburtsdatum angeben."))?;
    if date.year() < 1900 {
        return Err(error(
            "Geburtsdatum: Bitte ein Datum ab dem Jahr 1900 angeben.",
        ));
    }
    if birth_date > format!("{month}-01") {
        return Err(error(
            "Das Geburtsdatum liegt nach dem Beginn des gewählten Abrechnungsmonats.",
        ));
    }
    let tax_class = form
        .tax_class
        .ok_or_else(|| error("Bitte die Steuerklasse auswählen."))?;
    let church = form
        .church_tax_rate
        .ok_or_else(|| error("Bitte die Kirchensteuer auswählen."))?;
    let is_parent = form.is_parent.ok_or_else(|| {
        error("Bitte die Elterneigenschaft für die Pflegeversicherung auswählen.")
    })?;
    let saxony = form
        .works_in_saxony
        .ok_or_else(|| error("Bitte auswählen, ob du in Sachsen beschäftigt bist."))?;
    let special_cases = form.special_cases.as_ref().ok_or_else(|| {
        error("Bitte den regulären Abrechnungsfall oder einen passenden Sonderfall auswählen.")
    })?;
    if tax_class == 4.0 && form.factor_mode.is_none() {
        return Err(error(
            "Bitte für Steuerklasse IV das Faktorverfahren auswählen.",
        ));
    }
    let allowance = parse_decimal(
        &form.child_allowance,
        DecimalScale::Cents,
        "den Kinderfreibetrag",
    )?;
    if allowance % 50 != 0 {
        return Err(error(
            "Der Kinderfreibetrag muss in Schritten von 0,5 angegeben werden.",
        ));
    }
    if allowance > 1000 {
        return Err(error(
            "Kinderfreibetrag: Bitte einen Wert von 0 bis 10 angeben.",
        ));
    }
    if tax_class >= 5.0 && allowance != 0 {
        return Err(error(
            "Kinderfreibetrag: Bei Steuerklasse V und VI bitte 0 eintragen.",
        ));
    }
    let factor = if tax_class == 4.0 && form.factor_mode.as_deref() == Some("FACTOR") {
        Some(parse_decimal(
            &form.factor,
            DecimalScale::Permille,
            "den Faktor",
        )?)
    } else {
        None
    };
    if factor.is_some_and(|v| !(1..=999).contains(&v)) {
        return Err(error(
            "ELStAM-Faktor: Bitte einen Wert von 0,001 bis 0,999 angeben.",
        ));
    }
    let children = parse_decimal(
        &form.children_under25,
        DecimalScale::Units,
        "die Kinderzahl",
    )?;
    if children > 20 {
        return Err(error(
            "Kinder unter 25: Bitte eine ganze Zahl von 0 bis 20 angeben.",
        ));
    }
    if !is_parent && children != 0 {
        return Err(error(
            "Kinder unter 25: Bei Elterneigenschaft „Nein“ bitte 0 eintragen oder die Elterneigenschaft prüfen.",
        ));
    }
    let health = parse_decimal(
        &form.health_additional_rate,
        DecimalScale::Cents,
        "den vollen GKV-Zusatzbeitrag",
    )?;
    if health > 10_000 {
        return Err(error(
            "Voller GKV-Zusatzbeitrag: Bitte den Beitrag als Prozentwert von 0 bis 100 angeben.",
        ));
    }
    let sfn = if trim_javascript(&form.sfn_basic_hourly_pay).is_empty() {
        None
    } else {
        Some(parse_decimal(
            &form.sfn_basic_hourly_pay,
            DecimalScale::Cents,
            "den SFN-Grundlohn",
        )?)
    };
    if sfn == Some(0) {
        return Err(error(
            "SFN-Grundlohn: Bitte einen Betrag über 0 angeben oder das optionale Feld leeren.",
        ));
    }
    let monthly_allowance = parse_decimal(
        &form.monthly_tax_allowance,
        DecimalScale::Cents,
        "den monatlichen Freibetrag",
    )?;
    validate_monthly_net_pay_settings(&json!({"version":1,"month":month,"profile":{
        "birthDate":birth_date,"taxClass":tax_class,"factorPermille":factor,"churchTaxRatePercent":church,
        "childAllowanceHalfUnits":allowance/50,"isParent":is_parent,"childrenUnder25":children,"worksInSaxony":saxony,
        "healthAdditionalRateBps":health,"monthlyTaxAllowanceCents":monthly_allowance
    },"specialCases":special_cases,"sfnBasicHourlyPayCents":sfn})).map(ValidatedNetDraft).map_err(settings_error)
}
pub const HEALTH_FORECAST_RATE: &str = "2,90";
/// Native editor metadata; the host owns only text fields and disclosure state.
pub fn setup_editor(
    initial: Option<&InitialNetSettings>,
    works_in_saxony: bool,
    church_tax_default_percent: u8,
) -> Result<Value, InputError> {
    if ![8, 9].contains(&church_tax_default_percent) {
        return Err(shape_error());
    }
    let settings = initial.map(InitialNetSettings::settings);
    let profile = settings.and_then(|value| value.get("profile"));
    let automation = settings.and_then(|value| value.get("automation"));
    let field = |key: &str| automation.and_then(|value| value.get(key));
    let amount =
        |key: &str| display_decimal(field(key).and_then(Value::as_f64).unwrap_or(0.0), 100.0);
    let church_rate = profile
        .and_then(|value| value["churchTaxRatePercent"].as_u64())
        .filter(|value| *value != 0)
        .unwrap_or(u64::from(church_tax_default_percent));
    let pension_rate = field("pensionEmployeeRateBps")
        .and_then(Value::as_f64)
        .map(|value| display_decimal(value, 100.0))
        .unwrap_or_default();
    let own_schemes: Vec<_> = ["EZVK_DARMSTADT", "EZVK_KARLSRUHE"]
        .into_iter()
        .filter(|scheme| pension_max_own_rate(scheme).is_some())
        .collect();
    Ok(json!({
        "form":setup_values(initial, works_in_saxony)?,
        "churchRate":church_rate,
        "customHealth":profile.is_some_and(|value| value["healthAdditionalRateBps"] != 290),
        "pensionScheme":field("pensionScheme").cloned().unwrap_or(Value::Null),
        "pensionEmployeeRate":pension_rate,
        "additionalGross":amount("additionalRecurringGrossCents"),
        "additionalNet":amount("additionalNetDeductionCents"),
        "expanded":settings.is_none_or(|value| value["version"] == 1),
        "healthForecastRate":HEALTH_FORECAST_RATE,
        "pensionOwnRateSchemes":own_schemes
    }))
}
pub fn validate_step(month: &str, step: u32, form: &NetFormState) -> Result<(), InputError> {
    if form.tax_class.is_none() {
        return Err(error("Bitte deine Steuerklasse auswählen."));
    }
    if form.church_tax_rate.is_none() {
        return Err(error("Bitte auswählen, ob du Kirchensteuer zahlst."));
    }
    if step == 0 {
        let mut step_form = form.clone();
        step_form.birth_date = "01.01.1900".to_owned();
        step_form.is_parent = Some(false);
        step_form.children_under25 = "0".to_owned();
        step_form.health_additional_rate = HEALTH_FORECAST_RATE.to_owned();
        prepare_monthly(month, &step_form)?;
        return Ok(());
    }
    if form.is_parent.is_none() {
        return Err(error("Bitte auswählen, ob du Kinder hast."));
    }
    if step == 1 {
        let mut step_form = form.clone();
        step_form.factor_mode = Some("NONE".to_owned());
        step_form.child_allowance = "0".to_owned();
        step_form.monthly_tax_allowance = "0".to_owned();
        step_form.health_additional_rate = HEALTH_FORECAST_RATE.to_owned();
        prepare_monthly(month, &step_form)?;
    } else {
        prepare_monthly(month, form)?;
    }
    Ok(())
}

pub struct SetupInput<'a> {
    pub month: &'a str,
    pub form: &'a NetFormState,
    pub pension_scheme: Option<&'a str>,
    pub additional_gross: &'a str,
    pub additional_net: &'a str,
    pub initial: Option<&'a InitialNetSettings>,
    pub pension_employee_rate: &'a str,
}
pub fn prepare_setup(input: SetupInput<'_>) -> Result<ValidatedNetDraft, InputError> {
    validate_step(input.month, 3, input.form)?;
    let scheme = input
        .pension_scheme
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            error("Bitte Zusatzversorgung auswählen – auch „Weiß ich nicht“ ist möglich.")
        })?;
    let mut monthly = prepare_monthly(input.month, input.form)?.into_settings();
    monthly["version"] = json!(2);
    monthly["sfnBasicHourlyPayCents"] = Value::Null;
    let initial = input.initial.map(InitialNetSettings::settings);
    let mut automation = json!({"pensionScheme":scheme});
    if let Some(annual) = initial.and_then(|v| v["automation"].get("annualPayments")) {
        automation["annualPayments"] = annual.clone();
    }
    if pension_max_own_rate(scheme).is_some() {
        automation["pensionEmployeeRateBps"] =
            if trim_javascript(input.pension_employee_rate).is_empty() {
                Value::Null
            } else {
                json!(parse_decimal(
                    input.pension_employee_rate,
                    DecimalScale::Cents,
                    "den Eigenanteil der Zusatzversorgung"
                )?)
            };
    }
    // Checked initial settings have true confirmations; V1 has no automation.
    // These are the original visible-assumption defaults, never missing=0 casts.
    for key in ["fullMonthAndPayConfirmed", "plannedWorkConfirmed"] {
        automation[key] = initial
            .and_then(|v| v["automation"].get(key))
            .cloned()
            .unwrap_or(json!(true));
    }
    automation["additionalRecurringGrossCents"] = json!(parse_decimal(
        input.additional_gross,
        DecimalScale::Cents,
        "die weitere laufende Zulage"
    )?);
    automation["additionalNetDeductionCents"] = json!(parse_decimal(
        input.additional_net,
        DecimalScale::Cents,
        "die weiteren Netto-Abzüge"
    )?);
    monthly["automation"] = automation;
    validate_monthly_net_pay_settings(&monthly)
        .map(ValidatedNetDraft)
        .map_err(settings_error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawAmountForm {
    gross: String,
    taxable: String,
    social_insurance: String,
    regular_social_insurance: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedNetAmounts {
    gross_cents: i64,
    taxable_gross_cents: i64,
    social_insurance_gross_cents: i64,
    regular_monthly_social_insurance_gross_cents: i64,
}
pub fn parse_amounts(form: &RawAmountForm) -> Result<ParsedNetAmounts, InputError> {
    Ok(ParsedNetAmounts {
        gross_cents: parse_decimal(&form.gross, DecimalScale::Cents, "das Gesamtbrutto")?,
        taxable_gross_cents: parse_decimal(&form.taxable, DecimalScale::Cents, "das Steuerbrutto")?,
        social_insurance_gross_cents: parse_decimal(
            &form.social_insurance,
            DecimalScale::Cents,
            "das SV-Brutto",
        )?,
        regular_monthly_social_insurance_gross_cents: parse_decimal(
            &form.regular_social_insurance,
            DecimalScale::Cents,
            "das regelmäßige SV-Einkommen",
        )?,
    })
}
