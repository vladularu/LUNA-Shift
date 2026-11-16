mod common;
#[test]
fn drk_and_avrdd_drafts_keep_original_missing_fact_and_incomplete_boundaries() {
    use luna_engine::input::employment::encode_employment_payload;
    let source: Value =
        serde_json::from_str(include_str!("../../reference/drk-saved-golden.json")).unwrap();
    let employee = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["operation"] == "employeeSaved"
                && case["input"]["profiles"]
                    .as_array()
                    .is_some_and(|profiles| !profiles.is_empty())
        })
        .unwrap();
    let training = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["operation"] == "trainingSaved"
                && case["input"]["remunerationProfiles"]
                    .as_array()
                    .is_some_and(|profiles| !profiles.is_empty())
        })
        .unwrap();
    for (case, family, kind) in [
        (
            employee,
            "DRK_EMPLOYEE",
            SourceKind::DrkEmployeeMonthConfirmations,
        ),
        (
            training,
            "DRK_TRAINING",
            SourceKind::DrkTrainingMonthConfirmations,
        ),
    ] {
        let rows=case["input"].get("profiles").or_else(||case["input"].get("remunerationProfiles")).unwrap().as_array().unwrap().iter().map(|profile|json!({"id":format!("from:{}",profile["effectiveFrom"].as_str().unwrap()),"effective_from":profile["effectiveFrom"],"data_json":encode_employment_payload(&profile["data"],profile.get("employment"),profile.get("employmentOverrides")).unwrap(),"revision":profile["revision"],"created_at":profile["createdAt"],"updated_at":profile["updatedAt"]})).collect::<Vec<_>>();
        let mut input = raw();
        set(
            &mut input,
            SourceKind::RemunerationProfiles,
            ready(json!(rows)),
        );
        let facts = facts(input);
        let report = financial_report::gross(
            &facts,
            &ReportPeriod::Month {
                month: case["input"]["month"].as_str().unwrap().into(),
            },
            SalaryPerspective::Earned,
        )
        .unwrap();
        let candidate = &report["drafts"]["value"][0];
        assert_eq!(candidate["family"], family, "{}", report["drafts"]);
        assert_eq!(candidate["completeGross"], false);
        assert_eq!(candidate["result"]["state"], "UNAVAILABLE");
        assert_eq!(
            candidate["result"]["reason"]["source"],
            serde_json::to_value(kind).unwrap()
        );
    }
    let mut profile = employee["input"]["profiles"][0].clone();
    profile["data"]["selection"] = json!({"kind":"tariff","packageId":"avr-dd-anlage-1","variant":"ANLAGE_1","region":"AVR_DD","group":"EG7","level":"1","fullTimeWeeklyMinutes":2340});
    let row = json!({"id":format!("from:{}",profile["effectiveFrom"].as_str().unwrap()),"effective_from":profile["effectiveFrom"],"data_json":encode_employment_payload(&profile["data"],None,None).unwrap(),"revision":profile["revision"],"created_at":profile["createdAt"],"updated_at":profile["updatedAt"]});
    let mut input = raw();
    set(
        &mut input,
        SourceKind::RemunerationProfiles,
        ready(json!([row])),
    );
    let facts = facts(input);
    let report = financial_report::gross(
        &facts,
        &ReportPeriod::Month {
            month: employee["input"]["month"].as_str().unwrap().into(),
        },
        SalaryPerspective::Earned,
    )
    .unwrap();
    let candidate = &report["drafts"]["value"][0];
    assert_eq!(candidate["family"], "AVR_DD", "{}", report["drafts"]);
    assert_eq!(candidate["completeGross"], false);
    assert_eq!(candidate["result"]["value"]["kind"], "unavailable");
    assert!(candidate["result"]["value"]["issue"].is_object());
}
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, ReportPeriod, SalaryPerspective, SourceKind, ValidatedRequest,
    },
    runtime::{facts::SnapshotFacts, financial_report},
};
use serde_json::{Value, json};
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == kind)
        .unwrap()["source"] = state;
}
fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
            _ => panic!("snapshot expected"),
        };
    SnapshotFacts::new(snapshot)
}
fn raw() -> Value {
    let mut raw = snapshot::raw_snapshot(1, "financial-fixture", 1);
    let profile = json!({"profileRow":{"federal_state":"NW","holiday_region":"NONE","weekly_minutes":2310,"time_zone":"Europe/Berlin","pay_group":null,"pay_level":null,"tariff_sector":null,"tariff_region":"OTHER","full_time_weekly_minutes":null,"industry":"HEALTHCARE","manual_monthly_gross_cents":400000,"regular_rotating_night_work":null,"sunday_holiday_work_eligible":null,"all_employment_work_recorded":null,"display_name":null,"employer_name":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"salaryRows":[]});
    set(&mut raw, SourceKind::WorkProfile, ready(profile));
    for kind in [
        SourceKind::RemunerationProfiles,
        SourceKind::WorkPatternSettings,
        SourceKind::LegacyTariffDecisions,
        SourceKind::TestMonths,
        SourceKind::ActualAnnualPayments,
        SourceKind::TariffAnnualClaims,
    ] {
        set(&mut raw, kind, ready(json!([])));
    }
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(json!({"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}})),
    );
    for kind in [
        SourceKind::WorkingTimeTarget,
        SourceKind::YouthPreference,
        SourceKind::NetPaySettingsTimeline,
        SourceKind::SalaryPaymentPreferences,
    ] {
        set(
            &mut raw,
            kind,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        );
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    raw
}
#[test]
fn raw_manual_gross_is_displayed_without_tax_target_youth_or_cash_preferences() {
    let facts = facts(raw());
    let result = financial_report::gross(
        &facts,
        &ReportPeriod::Month {
            month: "2026-11".into(),
        },
        SalaryPerspective::Earned,
    )
    .unwrap();
    assert_eq!(result["legacy"]["state"], "READY");
    assert_eq!(result["legacy"]["value"]["estimatedGrossAmount"], 4000.0);
    assert!(result["legacy"]["value"].get("profile").is_none());
    assert!(result["legacy"]["value"].get("shifts").is_none());
    assert!(
        facts.net_settings().is_err()
            && facts.salary_preferences().is_err()
            && facts.calculation_profile().is_err()
    );
}

#[test]
fn native_section_read_failures_remain_independent_and_no_missing_setup_becomes_zero_net() {
    let facts = facts(raw());
    let month = ReportPeriod::Month {
        month: "2026-11".into(),
    };
    let error = financial_report::net(&facts, &month, SalaryPerspective::Earned).unwrap_err();
    assert_eq!(error.code, "SOURCE_READ_FAILED");
    assert_eq!(error.source, Some(SourceKind::NetPaySettingsTimeline));
    let payout = financial_report::gross(&facts, &month, SalaryPerspective::Payout).unwrap();
    assert_eq!(payout["legacy"]["state"], "UNAVAILABLE");
    assert_eq!(
        payout["legacy"]["reason"]["source"],
        "SALARY_PAYMENT_PREFERENCES"
    );
    assert_eq!(payout["assessedPerspective"], "EARNED");
}
#[test]
fn earned_year_is_original_annual_gross_and_payout_year_keeps_twelve_original_projections() {
    let mut input = raw();
    set(
        &mut input,
        SourceKind::SalaryPaymentPreferences,
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
    );
    let facts = facts(input);
    let year = ReportPeriod::Year { year: 2026 };
    let earned = financial_report::gross(&facts, &year, SalaryPerspective::Earned).unwrap();
    assert_eq!(earned["legacy"]["value"]["estimatedGrossAmount"], 48000.0);
    assert_eq!(earned["legacy"]["value"]["availablePayMonthCount"], 12);
    let payout = financial_report::gross(&facts, &year, SalaryPerspective::Payout).unwrap();
    assert_eq!(
        payout["legacy"]["value"]["earned"],
        earned["legacy"]["value"]
    );
    let months = payout["legacy"]["value"]["paymentMonths"]
        .as_array()
        .unwrap();
    assert_eq!(months.len(), 12);
    for month in months {
        assert_eq!(month["pay"]["estimatedGrossAmount"], 4000.0);
        for source in month["sources"].as_array().unwrap() {
            assert_eq!(source.as_object().unwrap().len(), 2);
            assert!(source.get("profile").is_none() && source.get("shifts").is_none());
        }
    }
}
#[test]
fn earned_net_does_not_read_unneeded_cash_preferences_and_ready_empty_means_not_configured() {
    let mut input = raw();
    set(
        &mut input,
        SourceKind::NetPaySettingsTimeline,
        ready(json!([])),
    );
    let facts = facts(input);
    let result = financial_report::net(
        &facts,
        &ReportPeriod::Year { year: 2026 },
        SalaryPerspective::Earned,
    )
    .unwrap();
    assert_eq!(result["availableMonthCount"], 0);
    assert_eq!(result["months"][0]["status"], "Noch nicht eingerichtet");
    assert!(facts.salary_preferences().is_err());
}
#[test]
fn original_manual_net_forecast_is_reached_from_only_original_sql_fact_groups() {
    let golden: Value =
        serde_json::from_str(include_str!("../../reference/financial-net-golden.json")).unwrap();
    let case = golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "manual-positive-2026-base-0-EARNED")
        .unwrap();
    let source: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let timeline = source["timeline"].as_array().unwrap();
    let rows=timeline.iter().map(|saved|json!({"month":saved["settings"]["month"],"settings_json":serde_json::to_string(&saved["settings"]).unwrap(),"revision":saved["revision"],"created_at":saved["createdAt"],"updated_at":saved["updatedAt"]})).collect::<Vec<_>>();
    let mut input = raw();
    set(
        &mut input,
        SourceKind::NetPaySettingsTimeline,
        ready(json!(rows)),
    );
    let facts = facts(input);
    let actual = financial_report::net(
        &facts,
        &ReportPeriod::Month {
            month: "2026-01".into(),
        },
        SalaryPerspective::Earned,
    )
    .unwrap();
    let expected = case["expected"]["forecasts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["month"] == "2026-01")
        .unwrap();
    assert_eq!(actual, expected["result"]);
    assert!(facts.salary_preferences().is_err() && facts.calculation_profile().is_err());
}

#[test]
fn original_raw_sql_profile_calendar_and_actual_preview_catalog_match_full_financial_sections() {
    let golden = value_pool::decode(include_str!(
        "../../reference/financial-snapshot-report-golden.json"
    ));
    assert_eq!(golden["cases"].as_array().unwrap().len(), 54);
    for case in golden["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut snapshot = raw();
        set(
            &mut snapshot,
            SourceKind::WorkProfile,
            ready(input["work"].clone()),
        );
        set(
            &mut snapshot,
            SourceKind::CalendarEntries,
            ready(
                json!({"shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],"platformCollationRanks":input["platformCollationRanks"]}),
            ),
        );
        let timeline=input["timeline"].as_array().unwrap().iter().map(|saved|json!({"month":saved["settings"]["month"],"settings_json":serde_json::to_string(&saved["settings"]).unwrap(),"revision":saved["revision"],"created_at":saved["createdAt"],"updated_at":saved["updatedAt"]})).collect::<Vec<_>>();
        set(
            &mut snapshot,
            SourceKind::NetPaySettingsTimeline,
            ready(json!(timeline)),
        );
        set(
            &mut snapshot,
            SourceKind::SalaryPaymentPreferences,
            ready(json!({"value":serde_json::to_string(&input["preferences"]).unwrap()})),
        );
        let facts = facts(snapshot);
        let period: ReportPeriod = serde_json::from_value(case["period"].clone()).unwrap();
        let perspective: SalaryPerspective =
            serde_json::from_value(case["perspective"].clone()).unwrap();
        let gross = financial_report::gross(&facts, &period, perspective).unwrap();
        assert_eq!(gross["legacy"]["state"], "READY", "{}", case["id"]);
        common::assert_json_eq(
            &gross["legacy"]["value"],
            &case["expected"]["legacy"]["value"],
            case["id"].as_str().unwrap(),
        );
        let net = financial_report::net(&facts, &period, perspective).unwrap();
        common::assert_json_eq(
            &net,
            &case["expected"]["net"]["value"],
            case["id"].as_str().unwrap(),
        );
    }
}

#[test]
fn relevant_caritas_saved_sources_stay_unavailable_until_successfully_read_then_remain_incomplete()
{
    use luna_engine::input::employment::encode_employment_payload;
    let original = value_pool::decode(include_str!(
        "../../reference/caritas-candidate-golden.json"
    ));
    let case = original["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["operation"] == "candidate"
                && case["input"]["snapshot"]["remunerationProfiles"]
                    .as_array()
                    .is_some_and(|profiles| !profiles.is_empty())
        })
        .unwrap();
    let profile = &case["input"]["snapshot"]["remunerationProfiles"][0];
    let row = json!({"id":format!("from:{}",profile["effectiveFrom"].as_str().unwrap()),"effective_from":profile["effectiveFrom"],"data_json":encode_employment_payload(&profile["data"],profile.get("employment"),profile.get("employmentOverrides")).unwrap(),"revision":profile["revision"],"created_at":profile["createdAt"],"updated_at":profile["updatedAt"]});
    let mut input = raw();
    set(
        &mut input,
        SourceKind::RemunerationProfiles,
        ready(json!([row])),
    );
    let month = ReportPeriod::Month {
        month: case["input"]["month"].as_str().unwrap().into(),
    };
    let missing = facts(input.clone());
    let report = financial_report::gross(&missing, &month, SalaryPerspective::Earned).unwrap();
    let candidate = &report["drafts"]["value"][0];
    assert_eq!(candidate["family"], "CARITAS", "{}", report["drafts"]);
    assert_eq!(candidate["completeGross"], false);
    assert_eq!(candidate["result"]["state"], "UNAVAILABLE");
    assert_eq!(
        candidate["result"]["reason"]["source"],
        "ANNEX_A_PAUSE_DETAILS"
    );
    for kind in [
        SourceKind::AnnexAPauseDetails,
        SourceKind::ScopedAllowanceDecisions,
        SourceKind::OvertimeAllocations,
        SourceKind::CaritasOvertimeConfirmations,
        SourceKind::CaritasMonthFacts,
        SourceKind::CaritasWorkDays,
    ] {
        set(&mut input, kind, ready(json!([])));
    }
    let read = facts(input);
    let report = financial_report::gross(&read, &month, SalaryPerspective::Earned).unwrap();
    let candidate = &report["drafts"]["value"][0];
    assert_eq!(candidate["result"]["state"], "READY");
    assert_eq!(candidate["completeGross"], false);
    assert_ne!(candidate["result"]["value"]["completeGross"], true);
    assert!(
        candidate["result"]["value"]
            .get("estimatedGrossAmount")
            .is_none()
    );
}
