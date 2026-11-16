mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, ReportPeriod, SalaryPerspective, SourceKind, ValidatedRequest,
    },
    runtime::{
        facts::SnapshotFacts, report::SectionOutput, view_composition::ViewCompositionSource,
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = json!(kind);
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["kind"] == kind)
        .unwrap()["source"] = state;
}
fn source(input: &Value) -> Value {
    let mut raw = snapshot::raw_snapshot(1, "monthly-salary-ui", 1);
    set(
        &mut raw,
        SourceKind::WorkProfile,
        ready(input["work"].clone()),
    );
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],"platformCollationRanks":input["platformCollationRanks"]}),
        ),
    );
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
    let timeline = input["timeline"].as_array().unwrap().iter().map(|row|json!({"month":row["settings"]["month"],"settings_json":serde_json::to_string(&row["settings"]).unwrap(),"revision":row["revision"],"created_at":row["createdAt"],"updated_at":row["updatedAt"]})).collect::<Vec<_>>();
    set(
        &mut raw,
        SourceKind::NetPaySettingsTimeline,
        ready(json!(timeline)),
    );
    set(
        &mut raw,
        SourceKind::SalaryPaymentPreferences,
        ready(json!({"value":serde_json::to_string(&input["preferences"]).unwrap()})),
    );
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    raw
}
fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot::seal(&mut raw);
    let request = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&request).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
    SnapshotFacts::new(snapshot)
}
fn value(output: SectionOutput) -> Value {
    match output {
        SectionOutput::Ready { value } => value,
        _ => panic!("ready expected: {output:?}"),
    }
}
#[test]
fn original_full_monthly_salary_ui_inputs_annual_forecast_and_projection_remain_native() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/monthly-salary-view-golden.json"
    ));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 72);
    let dump = std::env::var_os("LUNA_MONTHLY_SALARY_VIEW_DUMP");
    let row_fixture =
        value_pool::decode(include_str!("../../reference/analysis-net-row-golden.json"));
    let mut native_cases = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let facts = facts(source(&case["input"]));
        let views = ViewCompositionSource::from_facts(&facts);
        let period: ReportPeriod = serde_json::from_value(case["period"].clone()).unwrap();
        let perspective: SalaryPerspective =
            serde_json::from_value(case["perspective"].clone()).unwrap();
        let monthly = value(views.net(&period, perspective).overlay);
        assert_eq!(
            monthly["analysisSalaryInputs"]["state"], "READY",
            "{}",
            case["id"]
        );
        common::assert_json_eq(
            &monthly["analysisSalaryInputs"]["value"],
            &case["expected"]["inputs"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            monthly["analysisSalaryForecast"]["state"], "READY",
            "{}",
            case["id"]
        );
        let forecast = match monthly["analysisSalaryForecast"]["value"]["kind"].as_str() {
            Some("NONE") => Value::Null,
            Some("MONTHLY_NET_PAY") => monthly["monthlyNetPay"].clone(),
            other => panic!("invalid native forecast selection: {other:?}"),
        };
        common::assert_json_eq(
            &forecast,
            &case["expected"]["forecast"],
            case["id"].as_str().unwrap(),
        );
        let row_case = row_fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| {
                row["id"].as_str() == Some(&format!("raw-{}", case["id"].as_str().unwrap()))
            })
            .unwrap();
        assert_eq!(monthly["analysisNetRow"]["state"], "READY");
        common::assert_json_eq(
            &monthly["analysisNetRow"]["value"],
            &row_case["expected"],
            case["id"].as_str().unwrap(),
        );
        let month = case["period"]["month"].as_str().unwrap();
        let year = month[..4].parse().unwrap();
        let annual = value(
            views
                .gross(&ReportPeriod::Year { year }, SalaryPerspective::Earned)
                .overlay,
        );
        assert_eq!(
            annual["annualPaymentsState"]["state"], "READY",
            "{}",
            case["id"]
        );
        common::assert_json_eq(
            &annual["annualPaymentsState"]["value"],
            &case["expected"]["annual"],
            case["id"].as_str().unwrap(),
        );
        let gross = value(views.gross(&period, perspective).output);
        if perspective == SalaryPerspective::Payout {
            common::assert_json_eq(
                &gross["legacy"]["value"],
                &case["expected"]["projection"],
                case["id"].as_str().unwrap(),
            );
        }
        if dump.is_some() {
            native_cases.push(json!({"id":case["id"],"perspective":case["perspective"],"expected":case["expected"],"net":monthly,"annual":annual["annualPaymentsState"],"projection":gross["legacy"]}));
        }
    }
    if let Some(path) = dump {
        let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"engineVersion":luna_engine::ENGINE_VERSION,"sourceDigest":fixture["sourceDigest"],"fixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/monthly-salary-view-golden.json"))),"caseCount":native_cases.len(),"cases":native_cases})).unwrap();
        assert!(bytes.len() < 16 * 1024 * 1024);
        std::fs::write(path, bytes).unwrap();
    }
}
#[test]
fn failed_settings_remain_unavailable_without_hiding_independent_earned_gross() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/monthly-salary-view-golden.json"
    ));
    let mut raw = source(&fixture["cases"][1]["input"]);
    set(
        &mut raw,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = facts(raw);
    let views = ViewCompositionSource::from_facts(&facts);
    let period = ReportPeriod::Month {
        month: "2026-01".into(),
    };
    let net = value(views.net(&period, SalaryPerspective::Payout).overlay);
    for key in [
        "legacyState",
        "analysisSalaryInputs",
        "analysisSalaryForecast",
        "analysisNetRow",
    ] {
        assert_eq!(net[key]["state"], "UNAVAILABLE");
        assert_eq!(net[key]["reason"]["source"], "NET_PAY_SETTINGS_TIMELINE");
    }
    assert!(net.get("monthlyNetPay").is_none());
    let gross = value(views.gross(&period, SalaryPerspective::Earned).output);
    assert_eq!(gross["legacy"]["state"], "READY");
}
