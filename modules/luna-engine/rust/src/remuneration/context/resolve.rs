use super::{
    annual::annual_payment_rule_issues, has, model::*, rows, selection::resolve_tariff_selection,
    text, training::training_pay_issues,
};
use crate::{
    employment::{ResolutionStatus, resolve_remuneration_profile_ref},
    remuneration::{
        Presence,
        profile::{Selection, TariffSelection, validate_profile},
    },
    rules::{RulePackage, RuleResolver},
};
use serde_json::Value;

fn nullable<T>(p: Presence<T>) -> Option<T> {
    match p {
        Presence::Value(value) => Some(value),
        Presence::Missing | Presence::Null => None,
    }
}
fn fail<'a>(
    profile: Option<&'a Value>,
    code: IssueCode,
    msg: &str,
    pkg: Option<&'a RulePackage>,
) -> RemunerationContext<'a> {
    RemunerationContext::unavailable(profile, code, msg, pkg)
}
fn known_number(v: &Value, key: &str) -> Result<i64, ContextError> {
    v.get(key)
        .and_then(Value::as_i64)
        .ok_or(ContextError::InvalidRule)
}
fn exact_level(s: &str, max: u8) -> Option<u8> {
    if s.len() != 1 {
        return None;
    }
    s.parse::<u8>().ok().filter(|n| (1..=max).contains(n))
}
fn decimal_suffix<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let suffix = s.strip_prefix(prefix)?;
    if suffix.is_empty() || suffix.starts_with('0') || !suffix.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(suffix)
}

pub fn resolve_context<'a>(
    date: &str,
    history: &'a [Value],
    resolver: &'a RuleResolver,
    validation: &impl NativePackageValidator,
) -> Result<RemunerationContext<'a>, ContextError> {
    let resolved = resolve_remuneration_profile_ref(history, date)?;
    let profile = resolved.profile;
    let Some(p) = profile else {
        return Ok(fail(
            None,
            IssueCode::ProfileMissing,
            "Für diesen Zeitraum fehlt ein Vergütungsstand.",
            None,
        ));
    };
    if resolved.status == ResolutionStatus::UnknownEffectiveDate {
        return Ok(fail(
            profile,
            IssueCode::EffectiveDateUnknown,
            "Der Gültigkeitsbeginn der übernommenen Vergütung ist noch nicht bestätigt.",
            None,
        ));
    }
    let Ok(data) = validate_profile(&p["data"]) else {
        return Ok(fail(
            profile,
            IssueCode::ProfileInvalid,
            "Dieser Vergütungsstand wird noch nicht unterstützt.",
            None,
        ));
    };
    let weekly = data.weekly_minutes();
    let selected = match data.selection() {
        Selection::OwnConfigured { configuration } => {
            return Ok(RemunerationContext {
                profile,
                source: RemunerationSource::new(profile, None),
                kind: ContextKind::OwnConfigured {
                    configuration: configuration.clone(),
                    weekly_minutes: weekly,
                },
            });
        }
        Selection::OwnMonthly {
            monthly_gross_cents,
        } => {
            return Ok(RemunerationContext {
                profile,
                source: RemunerationSource::new(profile, None),
                kind: ContextKind::OwnMonthly {
                    monthly_cents: *monthly_gross_cents,
                    weekly_minutes: weekly,
                },
            });
        }
        Selection::Unconfigured => {
            return Ok(fail(
                profile,
                IssueCode::RemunerationUnconfigured,
                "Die Vergütung ist für diesen Zeitraum nicht eingerichtet.",
                None,
            ));
        }
        Selection::Tariff(s) => s,
    };
    let package_id = if resolver.is_bundled() && selected.package_id == "tvoed-vka-bt-k" {
        "tvoed-p-vka-legacy"
    } else {
        &selected.package_id
    };
    let pkg = match resolver.resolve_tariff(date, Some(package_id)) {
        Ok(pkg) => pkg,
        Err(error) => {
            let code = if error.code == "RULE_PACKAGE_AMBIGUOUS" {
                IssueCode::RulePackageAmbiguous
            } else {
                IssueCode::RulePackageNotFound
            };
            return Ok(fail(
                profile,
                code,
                "Das ausgewählte Tarifregelwerk ist für diesen Zeitraum nicht eindeutig verfügbar.",
                None,
            ));
        }
    };
    if pkg.package_id != package_id
        || pkg.valid_from.as_str() > date
        || pkg.valid_to.as_deref().is_some_and(|to| to < date)
    {
        return Ok(fail(
            profile,
            IssueCode::RulePackageNotFound,
            "Das Tarifregelwerk passt nicht zur Auswahl oder zum Zeitraum.",
            Some(pkg),
        ));
    }
    let result = match pkg.engine_contract_version {
        16 => {
            let declared = resolve_tariff_selection(pkg, &selected.variant, &selected.region);
            let group = selected.group.to_lowercase();
            let step = format!("s{}", selected.level);
            let eg = selected
                .group
                .strip_prefix("EG")
                .and_then(|s| {
                    let numeric = s.strip_suffix(['A', 'B', 'C']).unwrap_or(s);
                    numeric
                        .parse::<u8>()
                        .ok()
                        .filter(|n| (1..=15).contains(n) && numeric == n.to_string())
                })
                .is_some();
            if selected.package_id != "tvoed-vka-anlage-a"
                || pkg.status() != Some("DRAFT")
                || !validation.validate(pkg)?
                || !declared.as_ref().is_some_and(|d| {
                    d.family_id == "tvoed-vka-annex-a"
                        && d.engine_id == "tvoed-annex-a-v1"
                        && d.groups
                            .iter()
                            .any(|g| g.id == group && g.levels.contains(&step))
                })
                || !matches!(selected.variant.as_str(), "BT_K" | "BT_B")
                || selected.region != "VKA"
                || !eg
                || exact_level(&selected.level, 6).is_none()
            {
                return Ok(fail(
                    profile,
                    IssueCode::TariffUnsupported,
                    "Die TVöD-Anlage-A-Auswahl ist nicht als sicherer Tabellenentwurf verfügbar.",
                    Some(pkg),
                ));
            }
            ContextKind::TvoedAnnexADraft {
                rule_package: pkg,
                weekly_minutes: weekly,
                full_time_weekly_minutes: selected.full_time_weekly_minutes,
                variant: selected.variant.clone(),
                group_id: group,
                step_id: step,
            }
        }
        18 => {
            let declared = resolve_tariff_selection(pkg, &selected.variant, &selected.region);
            let group = selected.group.to_lowercase();
            let step = format!("s{}", selected.level);
            if selected.package_id != "tvoed-vka-sue-bt-b"
                || pkg.status() != Some("DRAFT")
                || !validation.validate(pkg)?
                || !declared.as_ref().is_some_and(|d| {
                    d.family_id == "tvoed-vka-sue"
                        && d.engine_id == "tvoed-sue-bt-b-table-draft-v1"
                        && d.groups
                            .iter()
                            .any(|g| g.id == group && g.levels.contains(&step))
                })
                || selected.variant != "BT_B"
                || selected.region != "VKA"
                || selected.full_time_weekly_minutes != 2340
                || weekly > 2340
                || exact_level(&selected.level, 6).is_none()
            {
                return Ok(fail(
                    profile,
                    IssueCode::TariffUnsupported,
                    "Die SuE-Auswahl ist nicht als sicherer BT-B-Tabellenentwurf verfügbar.",
                    Some(pkg),
                ));
            }
            ContextKind::TvoedSueDraft {
                rule_package: pkg,
                weekly_minutes: weekly,
                full_time_weekly_minutes: 2340,
                group_id: group,
                step_id: step,
            }
        }
        12 | 13 => return resolve_tdl_context(profile, date, pkg, selected, weekly, validation),
        10 => return resolve_training_context(profile, pkg, selected, weekly),
        11 if pkg.rules()["selection"]["employmentKind"] == "APPRENTICE" => {
            return resolve_training_context(profile, pkg, selected, weekly);
        }
        _ => {
            if !["tvoed-vka-bt-k", "tvoed-p-vka-legacy"].contains(&selected.package_id.as_str()) {
                return Ok(fail(
                    profile,
                    IssueCode::TariffUnsupported,
                    "Für diesen Tarif fehlt noch die geprüfte Berechnungsanbindung.",
                    Some(pkg),
                ));
            }
            if ![1, 2, 3, 11].contains(&pkg.engine_contract_version) {
                return Ok(fail(
                    profile,
                    IssueCode::TariffUnsupported,
                    "Für diesen Tarifvertrag fehlt noch die geprüfte Berechnungsanbindung.",
                    Some(pkg),
                ));
            }
            if pkg.engine_contract_version == 11 && !annual_payment_rule_issues(pkg).is_empty() {
                return Ok(fail(
                    profile,
                    IssueCode::TariffUnsupported,
                    "Die Jahresregeln des Tarifpakets sind unvollständig oder widersprüchlich.",
                    Some(pkg),
                ));
            }
            let r = pkg.rules();
            if r.get("selection").is_some() {
                let Some(d) = resolve_tariff_selection(pkg, &selected.variant, &selected.region)
                else {
                    return Ok(fail(
                        profile,
                        IssueCode::TableSelectionInvalid,
                        "Die Auswahl ist in diesem Tarifpaket nicht eindeutig hinterlegt.",
                        Some(pkg),
                    ));
                };
                if d.family_id != "tvoed-p"
                    || d.engine_id != "tvoed-p-v3"
                    || d.employment_kind != "EMPLOYEE"
                    || ["basePay", "timePremiums", "allowances", "overtime"]
                        .iter()
                        .any(|key| d.capabilities[*key] != "SUPPORTED")
                    || d.capabilities["annualPayment"]
                        != if pkg.engine_contract_version == 11 {
                            "SUPPORTED"
                        } else {
                            "UNSUPPORTED"
                        }
                {
                    return Ok(fail(
                        profile,
                        IssueCode::TariffUnsupported,
                        "Die angegebenen Tarifkomponenten benötigen eine andere Berechnungsanbindung.",
                        Some(pkg),
                    ));
                }
                if d.variant["specialPartId"]
                    != if selected.variant == "BT_K" {
                        "bt-k"
                    } else {
                        "bt-b"
                    }
                {
                    return Ok(fail(
                        profile,
                        IssueCode::TableSelectionInvalid,
                        "Die Tarifvariante passt nicht zur gewählten Berechnung.",
                        Some(pkg),
                    ));
                }
            }
            if decimal_suffix(&selected.group, "P").is_none()
                || !matches!(selected.region.as_str(), "OTHER" | "KAV_BW")
                || !matches!(selected.variant.as_str(), "BT_K" | "BT_B")
                || decimal_suffix(&selected.level, "").is_none()
            {
                return Ok(fail(
                    profile,
                    IssueCode::TableSelectionInvalid,
                    "Tarifbereich, Region, Gruppe oder Stufe sind nicht unterstützt.",
                    Some(pkg),
                ));
            }
            let selector = &r["selector"];
            let selected_part = if selected.variant == "BT_K" {
                "bt-k"
            } else {
                "bt-b"
            };
            let parts = selector.get("specialPartIds").and_then(Value::as_array);
            let contains = |part: &str| {
                parts
                    .map(|parts| has(parts, part))
                    .unwrap_or(selector["specialPartId"] == part)
            };
            if selector["agreementId"] != "tvoed-vka"
                || (!contains(selected_part)
                    && !(pkg.package_id == "tvoed-p-vka-legacy" && contains("bt-p")))
            {
                return Ok(fail(
                    profile,
                    IssueCode::TableSelectionInvalid,
                    "Das Tarifpaket gilt nicht für den gewählten Tarifbereich.",
                    Some(pkg),
                ));
            }
            let tables: Vec<_> = rows(r, "payTables")
                .iter()
                .filter(|t| t["id"] == selector["payTableId"])
                .collect();
            if tables.len() != 1 {
                return Ok(fail(
                    profile,
                    IssueCode::TableSelectionInvalid,
                    "Die Entgelttabelle ist nicht eindeutig ausgewählt.",
                    Some(pkg),
                ));
            }
            let entries = entries(
                pkg,
                &selected.group.to_lowercase(),
                &format!("s{}", selected.level),
            );
            if entries.len() != 1 {
                return Ok(fail(
                    profile,
                    if entries.is_empty() {
                        IssueCode::TableEntryMissing
                    } else {
                        IssueCode::TableEntryAmbiguous
                    },
                    "Für die gewählte Gruppe und Stufe fehlt ein eindeutiger Tabellenwert.",
                    Some(pkg),
                ));
            }
            let weekly_rules: Vec<_> = rows(r, "weeklyWorkingTimeRules")
                .iter()
                .filter(|r| {
                    has(rows(r, "sectors"), &selected.variant)
                        && has(rows(r, "tariffRegions"), &selected.region)
                })
                .collect();
            if r.get("weeklyWorkingTimeRules").is_some() && weekly_rules.len() != 1 {
                return Ok(fail(
                    profile,
                    IssueCode::WeeklyTimeMissing,
                    "Für Tarifbereich und Region fehlt eine eindeutige Vollzeit-Arbeitszeit.",
                    Some(pkg),
                ));
            }
            ContextKind::Tariff {
                rule_package: pkg,
                monthly_cents: known_number(entries[0], "monthlyCents")?,
                weekly_minutes: weekly,
                full_time_weekly_minutes: weekly_rules
                    .first()
                    .map(|r| known_number(r, "fullTimeWeeklyMinutes"))
                    .transpose()?
                    .unwrap_or(selected.full_time_weekly_minutes),
            }
        }
    };
    Ok(RemunerationContext {
        profile,
        source: RemunerationSource::new(profile, Some(pkg)),
        kind: result,
    })
}

fn resolve_training_context<'a>(
    profile: Option<&'a Value>,
    pkg: &'a RulePackage,
    s: &TariffSelection,
    weekly: i64,
) -> Result<RemunerationContext<'a>, ContextError> {
    let declared = resolve_tariff_selection(pkg, &s.variant, &s.region);
    let r = pkg.rules();
    if ![10, 11].contains(&pkg.engine_contract_version)
        || pkg.package_id != "tvaoed-pflege-vka"
        || !declared.as_ref().is_some_and(|d| {
            d.family_id == "tvaoed-pflege"
                && d.engine_id == "tvaoed-pflege-v1"
                && d.employment_kind == "APPRENTICE"
                && d.capabilities["basePay"] == "SUPPORTED"
        })
        || r.get("trainingPay").is_none()
        || !training_pay_issues(pkg).is_empty()
        || !annual_payment_rule_issues(pkg).is_empty()
    {
        return Ok(fail(
            profile,
            IssueCode::TariffUnsupported,
            "Für dieses Ausbildungsregelwerk fehlt eine eindeutige Berechnungsanbindung.",
            Some(pkg),
        ));
    }
    if r["selector"]["agreementId"] != "tvaoed-vka"
        || !matches!(s.variant.as_str(), "BT_K" | "BT_B")
        || !matches!(s.region.as_str(), "OTHER" | "KAV_BW")
        || declared.as_ref().is_none_or(|d| {
            d.variant["specialPartId"] != if s.variant == "BT_K" { "bt-k" } else { "bt-b" }
        })
    {
        return Ok(fail(
            profile,
            IssueCode::TableSelectionInvalid,
            "Ausbildungsbereich oder Tarifregion passen nicht zum Regelwerk.",
            Some(pkg),
        ));
    }
    let category = rows(&r["trainingPay"], "categories")
        .iter()
        .find(|c| c["groupId"] == s.group);
    let year = exact_level(&s.level, 6);
    let Some((category, year)) = category.zip(year).filter(|(c, y)| {
        rows(c, "years")
            .iter()
            .any(|n| n.as_u64() == Some(u64::from(*y)))
    }) else {
        return Ok(fail(
            profile,
            IssueCode::TableSelectionInvalid,
            "Bitte Ausbildungskategorie und vergütetes Ausbildungsjahr ausdrücklich wählen.",
            Some(pkg),
        ));
    };
    let entries = entries(pkg, &s.group, &format!("s{}", s.level));
    if entries.len() != 1 {
        return Ok(fail(
            profile,
            if entries.is_empty() {
                IssueCode::TableEntryMissing
            } else {
                IssueCode::TableEntryAmbiguous
            },
            "Für dieses Ausbildungsjahr fehlt ein eindeutiges Ausbildungsentgelt.",
            Some(pkg),
        ));
    }
    let weekly_rules: Vec<_> = rows(r, "weeklyWorkingTimeRules")
        .iter()
        .filter(|r| has(rows(r, "sectors"), &s.variant) && has(rows(r, "tariffRegions"), &s.region))
        .collect();
    if weekly_rules.len() != 1 {
        return Ok(fail(
            profile,
            IssueCode::WeeklyTimeMissing,
            "Für diesen Ausbildungsbereich fehlt die tarifliche Vollzeitbasis.",
            Some(pkg),
        ));
    }
    let full = known_number(weekly_rules[0], "fullTimeWeeklyMinutes")?;
    if weekly > full {
        return Ok(fail(
            profile,
            IssueCode::ProfileInvalid,
            "Ausbildungsstunden über der Vollzeitbasis benötigen eine gesonderte Klärung; sie erhöhen nicht automatisch das Ausbildungsentgelt.",
            Some(pkg),
        ));
    }
    Ok(RemunerationContext {
        profile,
        source: RemunerationSource::new(profile, Some(pkg)),
        kind: ContextKind::TrainingTariff {
            rule_package: pkg,
            monthly_cents: known_number(entries[0], "monthlyCents")?,
            weekly_minutes: weekly,
            full_time_weekly_minutes: full,
            category_label: text(category, "label").ok_or(ContextError::InvalidRule)?,
            training_year: year,
            sector: s.variant.clone(),
            tariff_region: s.region.clone(),
            special_duty_allowance: nullable(s.special_duty_allowance.clone()),
        },
    })
}
fn resolve_tdl_context<'a>(
    profile: Option<&'a Value>,
    date: &str,
    pkg: &'a RulePackage,
    s: &TariffSelection,
    weekly: i64,
    validation: &impl NativePackageValidator,
) -> Result<RemunerationContext<'a>, ContextError> {
    let tval = pkg.engine_contract_version == 13;
    if !validation.validate(pkg)? {
        return Ok(fail(
            profile,
            IssueCode::TariffUnsupported,
            if tval {
                "Das TVA-L-Pflege-Regelpaket ist unvollständig oder nicht unterstützt."
            } else {
                "Das TV-L/KR-Regelpaket ist unvollständig oder nicht unterstützt."
            },
            Some(pkg),
        ));
    }
    let declared = resolve_tariff_selection(pkg, &s.variant, &s.region);
    let r = pkg.rules();
    let category = rows(&r["tvalTrainingPay"], "categories")
        .iter()
        .find(|c| c["groupId"] == s.group);
    let period = category.and_then(|c| rows(c, "levels").iter().find(|l| l["id"] == s.level));
    let kr = decimal_suffix(&s.group, "KR")
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (5..=17).contains(&n));
    if s.package_id != pkg.package_id
        || declared.is_none()
        || if tval {
            category.is_none() || period.is_none()
        } else {
            !kr || exact_level(&s.level, 6).is_none()
        }
    {
        return Ok(fail(
            profile,
            IssueCode::TableSelectionInvalid,
            if tval {
                "Bitte TVA-L-Geltung, Tarifgebiet, Ausbildungskategorie und vergüteten Ausbildungszeitraum ausdrücklich bestätigen."
            } else {
                "Bitte TV-L/KR-Bereich, Tarifgebiet, Gruppe und Stufe ausdrücklich wählen."
            },
            Some(pkg),
        ));
    }
    let group = if tval {
        s.group.clone()
    } else {
        s.group.to_lowercase()
    };
    let entries = entries(pkg, &group, &s.level);
    if entries.len() != 1 {
        return Ok(fail(
            profile,
            if entries.is_empty() {
                IssueCode::TableEntryMissing
            } else {
                IssueCode::TableEntryAmbiguous
            },
            if tval {
                "Für diesen Ausbildungszeitraum fehlt ein eindeutiger Tabellenwert."
            } else {
                "Für diese KR-Gruppe und Stufe fehlt ein eindeutiger Tabellenwert."
            },
            Some(pkg),
        ));
    }
    let working: Vec<_> = rows(r, "employmentWorkingTimeRules")
        .iter()
        .filter(|w| {
            w["variantId"] == s.variant
                && w["regionId"] == s.region
                && text(w, "validFrom").is_some_and(|from| from <= date)
                && (w["validTo"].is_null() || text(w, "validTo").is_some_and(|to| date <= to))
        })
        .collect();
    if working.len() != 1 {
        return Ok(fail(
            profile,
            IssueCode::WeeklyTimeMissing,
            if tval {
                "Für diesen Zeitraum fehlt eine eindeutige TVA-L-Vollzeitbasis."
            } else {
                "Für diesen Zeitraum fehlt eine eindeutige TV-L-Vollzeitbasis."
            },
            Some(pkg),
        ));
    }
    let full = known_number(working[0], "fullTimeWeeklyMinutes")?;
    if weekly > full {
        return Ok(fail(
            profile,
            IssueCode::ProfileInvalid,
            if tval {
                "Die vereinbarte Ausbildungszeit liegt über der gewählten Vollzeitbasis. Bitte die bestätigte Konstellation prüfen; zusätzliche Stunden erhöhen nicht automatisch das Ausbildungsentgelt."
            } else {
                "Die vereinbarten Wochenstunden liegen über der tariflichen Vollzeitbasis. Bitte den datierten Beschäftigungsumfang prüfen; Mehrstunden erhöhen nicht automatisch das Grundentgelt."
            },
            Some(pkg),
        ));
    }
    let monthly = known_number(entries[0], "monthlyCents")?;
    let kind = if tval {
        ContextKind::TvalTraining {
            rule_package: pkg,
            monthly_cents: monthly,
            weekly_minutes: weekly,
            full_time_weekly_minutes: full,
            category_label: text(category.ok_or(ContextError::InvalidRule)?, "label")
                .ok_or(ContextError::InvalidRule)?,
            period_label: text(period.ok_or(ContextError::InvalidRule)?, "label")
                .ok_or(ContextError::InvalidRule)?,
            employer_scope: nullable(s.tval_employer_scope.clone()),
            employment_category: nullable(s.tvl_employment_category.clone()),
            care_allowances: nullable(s.tval_care_allowances.clone()),
        }
    } else {
        ContextKind::TvlKr {
            rule_package: pkg,
            monthly_cents: monthly,
            weekly_minutes: weekly,
            full_time_weekly_minutes: full,
            group_id: group,
            employment_category: nullable(s.tvl_employment_category.clone()),
            care_allowances: nullable(s.tvl_care_allowances.clone()),
        }
    };
    Ok(RemunerationContext {
        profile,
        source: RemunerationSource::new(profile, Some(pkg)),
        kind,
    })
}
