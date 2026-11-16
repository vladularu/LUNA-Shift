//! Raw standby subform presentation/actions, never saved facts or write permits.
use super::{
    InputError, form_number,
    javascript_json::number_text,
    special_duty,
    special_duty_clock::{self, DutyClockOperation},
};
use serde_json::{Value, json};
const TARIFFS: [&str; 5] = ["TVOED_K", "TVOED_B", "TVL_43", "TVH_43", "TVUK"];
fn invalid() -> InputError {
    InputError::source("Bitte prüfe die Angaben zur Bereitschaft.", "Error")
}
fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str, InputError> {
    v[k].as_str().ok_or_else(invalid)
}
fn name(tariff: &str) -> Result<&'static str, InputError> {
    Ok(match tariff {
        "TVOED_K" => "TVöD Krankenhaus",
        "TVOED_B" => "TVöD Pflege/Betreuung",
        "TVL_43" => "TV-L Pflege",
        "TVH_43" => "TV-H Pflege",
        "TVUK" => "TV-UK",
        _ => return Err(invalid()),
    })
}
fn new_agreement(tariff: &str) -> Result<Value, InputError> {
    name(tariff)?;
    Ok(
        json!({"tariff":tariff,"rule":"UNKNOWN","sequence":null,"payGroup":null,"rateMode":"TABLE","hourlyCents":null,"timeOffMode":"UNKNOWN"}),
    )
}
fn tariff(props: &Value) -> Result<Option<&str>, InputError> {
    let result = props["tariffFamily"]
        .as_str()
        .or_else(|| props["value"]["standbyAgreement"]["tariff"].as_str());
    if let Some(value) = result {
        name(value)?;
    }
    Ok(result)
}
fn agreement(props: &Value, matching: bool) -> Result<Option<Value>, InputError> {
    let existing = &props["value"]["standbyAgreement"];
    if existing.is_object() && (!matching || existing["tariff"].as_str() == tariff(props)?) {
        return Ok(Some(existing.clone()));
    }
    tariff(props)?.map(new_agreement).transpose()
}
fn groups(tariff: &str) -> Result<Vec<Value>, InputError> {
    if !["TVL_43", "TVH_43", "TVOED_B"].contains(&tariff) {
        return Ok(vec![]);
    }
    let tables = crate::pay::special::rates::tables().map_err(|_| invalid())?;
    let values = if tariff == "TVOED_B" {
        &tables["vka"]["TVOED_B"]
    } else {
        &tables["tvl"]
    };
    let mut result = vec![];
    for value in values.as_object().ok_or_else(invalid)?.keys() {
        let label = if tariff != "TVOED_B" {
            format!(
                "Kr. {} (Bereitschaftsgruppe)",
                value.get(3..).ok_or_else(invalid)?
            )
        } else if let Some(group) = value.strip_prefix("WORKER_") {
            format!("{group} · Anlage G III")
        } else if value.starts_with('E') {
            format!("{value} · Anlage G I")
        } else {
            continue;
        };
        result.push(json!({"value":value,"label":label}));
    }
    Ok(result)
}
fn choice(label: &str, value: Value, options: Vec<Value>) -> Value {
    json!({"type":"DutyChoice","label":label,"value":value,"options":options})
}
fn option(value: &str, label: &str) -> Value {
    json!({"value":value,"label":label})
}
fn note(kind: &str, text: &str) -> Value {
    json!({"type":kind,"text":text})
}
fn row(kind: &str, label: &str, value: Value) -> Value {
    json!({"type":kind,"label":label,"value":value})
}
fn clock(minutes: &Value) -> Result<Value, InputError> {
    let result =
        special_duty_clock::execute(DutyClockOperation::ClockLabel, &json!({"minutes":minutes}))?;
    if result["ok"] != true {
        return Err(invalid());
    }
    result.get("value").cloned().ok_or_else(invalid)
}
fn minute(value: &str) -> Result<i64, InputError> {
    special_duty::clock(&json!(value))
}
fn break_clock(props: &Value) -> Result<Value, InputError> {
    let duty = &props["value"];
    clock(&if duty["breakStart"].is_null() {
        json!(minute(text(props, "startTime")?)?)
    } else {
        duty["breakStart"].clone()
    })
}
fn view(component: u64, props: &Value, state: &[Value]) -> Result<Vec<Value>, InputError> {
    let mut out = vec![];
    let duty = &props["value"];
    match component {
        0 => {
            let open = state[0].as_bool().ok_or_else(invalid)?;
            let a = agreement(props, false)?;
            let rule = a.as_ref().and_then(|a| a["rule"].as_str());
            let mut first = row(
                "DutyValueRow",
                "Abrechnung",
                json!(if open {
                    "Schließen"
                } else if rule.is_some_and(|v| v != "UNKNOWN") {
                    "Grundlage bearbeiten"
                } else {
                    "Angaben ergänzen"
                }),
            );
            first["expanded"] = json!(open);
            out.push(first);
            if !open {
                return Ok(out);
            }
            if let Some(t) = props["tariffFamily"].as_str() {
                out.push(note(
                    "Text",
                    &format!("Tarif aus deinem Profil: {}", name(t)?),
                ));
            } else {
                let mut options = vec![option("UNKNOWN", "Bitte wählen")];
                for t in TARIFFS {
                    options.push(option(t, name(t)?));
                }
                out.push(choice(
                    "Tarifbereich der Bereitschaft",
                    json!(tariff(props)?.unwrap_or("UNKNOWN")),
                    options,
                ));
            }
            let (Some(a), Some(t)) = (a, tariff(props)?) else {
                return Ok(out);
            };
            let own = a["rateMode"] == "AGREED";
            let monthly = ["TVOED_B", "TVL_43", "TVH_43"].contains(&t);
            if a["tariff"] != t {
                out.push(note("Text",&format!("Diese Bereitschaft ist noch mit {} gespeichert. Wähle die Abrechnungsgrundlage für {} erneut.",name(text(&a,"tariff")?)?,name(t)?)));
            }
            let mut rules = vec![
                option("UNKNOWN", "Weiß ich noch nicht"),
                option("STANDARD", "Reguläre Bewertung"),
            ];
            if ["TVOED_K", "TVOED_B"].contains(&t) {
                rules.push(option("CARE", "Betreuung nach §45 Abs.10"));
            }
            out.push(choice(
                "Bewertung laut Arbeitgeber",
                if a["tariff"] == t {
                    a["rule"].clone()
                } else {
                    json!("UNKNOWN")
                },
                rules,
            ));
            if monthly {
                if props["template"] == true {
                    out.push(note(
                        "Text",
                        "Die Monatsnummer ergänzt du später im Kalendereintrag.",
                    ));
                } else {
                    out.push(row(
                        "Field",
                        "Nummer der Bereitschaft im Monat",
                        json!(a["sequence"].as_f64().map(number_text).unwrap_or_default()),
                    ));
                }
            }
            let mut options = groups(t)?;
            if !options.is_empty() && !own {
                options.insert(
                    0,
                    option(
                        "AUTO",
                        if t == "TVOED_B" {
                            "Aus Tarifprofil"
                        } else {
                            "Weiß ich noch nicht"
                        },
                    ),
                );
                out.push(choice(
                    "Bereitschaftsgruppe laut Arbeitgeber",
                    a.get("payGroup")
                        .filter(|v| !v.is_null())
                        .cloned()
                        .unwrap_or(json!("AUTO")),
                    options,
                ));
            }
            if ["TVL_43", "TVH_43"].contains(&t) && !own {
                out.push(note(
                    "Text",
                    "Die Bereitschaftsgruppe kann von deiner aktuellen KR-Gruppe abweichen.",
                ));
            }
            out.push(row(
                "DutyValueRow",
                "Stundenentgelt",
                json!(if own {
                    "Laut Arbeitgeber"
                } else {
                    "Aus Tariftabelle"
                }),
            ));
            if own {
                out.push(row(
                    "Field",
                    "Stundenentgelt vor Bewertung (€)",
                    state[1].clone(),
                ));
                out.push(note("Text","Für individuelle Zuordnungen und Ausbildung: den bestätigten Stundensatz vor der Bereitschaftsbewertung eintragen."));
            }
        }
        1 => {
            if duty["kind"] != "STANDBY" || duty["settlement"] != "TIME_OFF" {
                return Ok(out);
            }
            let Some(t) = tariff(props)? else {
                return Ok(vec![note(
                    "DutyHint",
                    "Wähle unter Abrechnung zuerst den Tarifbereich deiner Bereitschaft.",
                )]);
            };
            let a = agreement(props, true)?.ok_or_else(invalid)?;
            let mut options = vec![
                option("UNKNOWN", "Bitte wählen"),
                option("WEIGHTED", "Bewertete Dienstzeit"),
            ];
            if t == "TVOED_K" {
                options.push(option("FACTORIZED", "Fester Minutenfaktor"));
            }
            out.push(choice(
                "Berechnung der Zeitgutschrift",
                a["timeOffMode"].clone(),
                options,
            ));
            out.push(note("DutyHint",match a["timeOffMode"].as_str(){Some("UNKNOWN")=>"Wähle das Verfahren laut Vereinbarung. Bis dahin bleiben Gehalt und Zeitkonto offen.",Some("FACTORIZED")=>"Die vereinbarten Minuten je Dienststunde bestimmen deine Zeitgutschrift.",_=>"Bereitschaftsstufe und umwandelbare Zuschläge bestimmen deine Zeitgutschrift."}));
        }
        2 => {
            if duty["kind"] != "STANDBY"
                || props["breakMinutes"].as_f64().ok_or_else(invalid)? <= 0.0
                || (duty["breakStart"].is_null()
                    && duty["endDay"] == 0
                    && minute(text(props, "startTime")?)? >= 360
                    && minute(text(props, "endTime")?)? <= 1200)
            {
                return Ok(out);
            }
            let label = if duty["breakStart"].is_null() {
                "Noch offen".to_owned()
            } else {
                format!(
                    "{}{}",
                    clock(&duty["breakStart"])?.as_str().ok_or_else(invalid)?,
                    if duty["breakStart"].as_f64().ok_or_else(invalid)? >= 1440.0 {
                        " · Folgetag"
                    } else {
                        ""
                    }
                )
            };
            out.push(row("EntryEditValueRow", "Pausenbeginn", json!(label)));
            if state[0] == true {
                out.push(row(
                    "EntryEditTimeRow",
                    "Beginn der echten Pause",
                    state[1].clone(),
                ));
                out.push(note("Text","Nur eine Pause ohne Bereitschaftspflicht. Der Beginn ordnet Nacht- und Feiertagszuschläge richtig zu."));
                out.push(row(
                    "EntryEditValueRow",
                    "Pausenbeginn übernehmen",
                    state[1].clone(),
                ));
                if !duty["breakStart"].is_null() {
                    out.push(row(
                        "EntryEditValueRow",
                        "Pausenbeginn offen lassen",
                        json!(""),
                    ));
                }
            }
        }
        _ => return Err(invalid()),
    }
    Ok(out)
}
fn update(props: &Value, agreement: Value) -> Value {
    let mut next = props["value"].clone();
    next["version"] = json!(if next["version"] == 3 { 3 } else { 2 });
    next["standbyAgreement"] = agreement;
    next
}
fn valid_rate(text: &str) -> bool {
    let mut parts = text.split([',', '.']);
    let Some(first) = parts.next() else {
        return false;
    };
    if first.len() > 4 || !first.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if let Some(fraction) = parts.next()
        && (fraction.len() > 2 || !fraction.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    parts.next().is_none()
}
pub fn execute(input: &Value) -> Result<Value, InputError> {
    let component = input["component"]
        .as_u64()
        .filter(|v| *v <= 2)
        .ok_or_else(invalid)?;
    let props = &input["props"];
    if !props["value"].is_object() {
        return Err(invalid());
    }
    let mut form = match input.get("state").filter(|value| !value.is_null()) {
        None => StandbyFieldsState::new(component, props)?,
        Some(raw) => {
            // Only transient raw React text/picker state. No saved values,
            // readiness flags or permission can be supplied through this array.
            let state = raw.as_array().ok_or_else(invalid)?;
            let valid = if component == 1 {
                state.is_empty()
            } else {
                state.len() == 2
                    && state[0].is_boolean()
                    && state[1]
                        .as_str()
                        .is_some_and(|value| value.len() <= 262_144)
            };
            if !valid {
                return Err(invalid());
            }
            StandbyFieldsState {
                component,
                state: state.clone(),
            }
        }
    };
    form.apply(props, input["actions"].as_array().ok_or_else(invalid)?)
}
/// Private local React-equivalent state; parent duty changes do not reset typed text or pickers.
/// It is never a source receipt, a deserializable form handle, or a write permit.
pub struct StandbyFieldsState {
    component: u64,
    state: Vec<Value>,
}
impl StandbyFieldsState {
    pub fn view(&self, props: &Value) -> Result<Value, InputError> {
        Ok(
            json!({"controls":view(self.component,props,&self.state)?,"state":self.state,"events":[]}),
        )
    }
    pub fn view_ui(&self, props: &Value) -> Result<Value, InputError> {
        let mut result = self.view(props)?;
        append_ui(&mut result)?;
        Ok(result)
    }
    pub fn new(component: u64, props: &Value) -> Result<Self, InputError> {
        if component > 2 || !props["value"].is_object() {
            return Err(invalid());
        }
        let state = match component {
            0 => vec![
                json!(props["initiallyOpen"] == true),
                json!(
                    props["value"]["standbyAgreement"]["hourlyCents"]
                        .as_f64()
                        .map(|v| number_text(v / 100.0).replacen('.', ",", 1))
                        .unwrap_or_default()
                ),
            ],
            1 => vec![],
            _ => vec![json!(false), break_clock(props)?],
        };
        Ok(Self { component, state })
    }
    pub fn apply(&mut self, props: &Value, actions: &[Value]) -> Result<Value, InputError> {
        if !props["value"].is_object() || actions.len() > 32 {
            return Err(invalid());
        }
        let component = self.component;
        let state = &mut self.state;
        let mut events = vec![];
        for action in actions {
            let kind = text(action, "type")?;
            let label = text(action, "label")?;
            let callback = text(action, "callback")?;
            let controls = view(component, props, state)?;
            if !controls
                .iter()
                .any(|c| c["type"] == kind && c["label"] == label)
            {
                return Err(invalid());
            }
            let next = &action["value"];
            match component {
                0 => {
                    if kind == "DutyValueRow" && label == "Abrechnung" && callback == "onPress" {
                        state[0] = json!(state[0] != true);
                        continue;
                    }
                    if label == "Tarifbereich der Bereitschaft" && callback == "onChange" {
                        let t = next.as_str().ok_or_else(invalid)?;
                        if t != "UNKNOWN" {
                            state[1] = json!("");
                            events.push(update(props, new_agreement(t)?));
                        }
                        continue;
                    }
                    let mut a = agreement(props, false)?.ok_or_else(invalid)?;
                    let t = tariff(props)?.ok_or_else(invalid)?;
                    match (label, callback) {
                        ("Bewertung laut Arbeitgeber", "onChange") => {
                            if a["tariff"] != t {
                                a = new_agreement(t)?;
                            }
                            if !["UNKNOWN", "STANDARD", "CARE"]
                                .contains(&next.as_str().ok_or_else(invalid)?)
                            {
                                return Err(invalid());
                            }
                            a["tariff"] = json!(t);
                            a["rule"] = next.clone();
                        }
                        ("Nummer der Bereitschaft im Monat", "onChangeText") => {
                            let value = next.as_str().ok_or_else(invalid)?;
                            if !value.is_empty()
                                && (value.len() > 3
                                    || value.starts_with('0')
                                    || !value.bytes().all(|b| b.is_ascii_digit())
                                    || form_number::number(value) > 100.0)
                            {
                                continue;
                            }
                            a["sequence"] = if value.is_empty() {
                                Value::Null
                            } else {
                                json!(form_number::number(value))
                            };
                        }
                        ("Bereitschaftsgruppe laut Arbeitgeber", "onChange") => {
                            let group = next.as_str().ok_or_else(invalid)?;
                            a["payGroup"] = if group == "AUTO" {
                                Value::Null
                            } else {
                                next.clone()
                            };
                        }
                        ("Stundenentgelt", "onPress") => {
                            state[1] = json!("");
                            a["rateMode"] = json!(if a["rateMode"] == "AGREED" {
                                "TABLE"
                            } else {
                                "AGREED"
                            });
                            a["hourlyCents"] = Value::Null;
                        }
                        ("Stundenentgelt vor Bewertung (€)", "onChangeText") => {
                            let value = next.as_str().ok_or_else(invalid)?;
                            if !valid_rate(value) {
                                continue;
                            }
                            state[1] = next.clone();
                            let cents = (form_number::number(&value.replacen(',', ".", 1)) * 100.0
                                + 0.5)
                                .floor();
                            a["hourlyCents"] =
                                if !value.is_empty() && (1.0..=100000.0).contains(&cents) {
                                    json!(cents)
                                } else {
                                    Value::Null
                                };
                        }
                        _ => return Err(invalid()),
                    }
                    events.push(update(props, a));
                }
                1 => {
                    if callback != "onChange" {
                        return Err(invalid());
                    }
                    let mut a = agreement(props, true)?.ok_or_else(invalid)?;
                    if !["UNKNOWN", "WEIGHTED", "FACTORIZED"]
                        .contains(&next.as_str().ok_or_else(invalid)?)
                    {
                        return Err(invalid());
                    }
                    a["timeOffMode"] = next.clone();
                    events.push(update(props, a));
                }
                2 => match (label, callback) {
                    ("Pausenbeginn", "onPress") => {
                        state[1] = break_clock(props)?;
                        state[0] = json!(state[0] != true);
                    }
                    ("Beginn der echten Pause", "onChange") => {
                        minute(next.as_str().ok_or_else(invalid)?)?;
                        state[1] = next.clone();
                    }
                    ("Pausenbeginn übernehmen", "onPress")
                    | ("Pausenbeginn offen lassen", "onPress") => {
                        let mut value = props["value"].clone();
                        value["version"] = json!(3);
                        if value.get("standbyAgreement").is_none() {
                            value["standbyAgreement"] = Value::Null;
                        }
                        value["breakStart"] = if label == "Pausenbeginn offen lassen" {
                            Value::Null
                        } else {
                            let m = minute(state[1].as_str().ok_or_else(invalid)?)?;
                            json!(if m < minute(text(props, "startTime")?)? {
                                m + 1440
                            } else {
                                m
                            })
                        };
                        events.push(value);
                        state[0] = json!(false);
                    }
                    _ => return Err(invalid()),
                },
                _ => return Err(invalid()),
            }
        }
        Ok(json!({"controls":view(component,props,state)?,"state":state,"events":events}))
    }
}

fn append_ui(value: &mut Value) -> Result<(), InputError> {
    let controls = value["controls"].as_array().ok_or_else(invalid)?;
    let fields: Vec<Value> = controls
        .iter()
        .enumerate()
        .filter(|(_, control)| control["type"] == "Field")
        .map(|(index, control)| {
            let keyboard = match control["label"].as_str() {
                Some("Nummer der Bereitschaft im Monat") => Ok("number-pad"),
                Some("Stundenentgelt vor Bewertung (€)") => Ok("decimal-pad"),
                _ => Err(invalid()),
            }?;
            Ok(json!({"index":index,"keyboardType":keyboard}))
        })
        .collect::<Result<_, InputError>>()?;
    value["ui"] = json!({"fields":fields});
    Ok(())
}
pub fn execute_ui(input: &Value) -> Result<Value, InputError> {
    let mut result = execute(input)?;
    append_ui(&mut result)?;
    Ok(result)
}
