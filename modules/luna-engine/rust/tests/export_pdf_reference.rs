#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    report::{
        export_pdf::{
            model::{PdfLayout, PdfOptions},
            plan_pdf,
        },
        export_rows::ReportEntry,
        export_view::model::{ReportDocumentRef, ReportRow},
    },
    target::MonthlyTarget,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap().to_owned()
}
fn entry(v: &Value) -> ReportEntry {
    ReportEntry {
        date: text(v, "date"),
        title: text(v, "title"),
        kind: text(v, "kind"),
        type_label: text(v, "typeLabel"),
        color: text(v, "color"),
        all_day: v["allDay"].as_bool().unwrap(),
        start_time: v["startTime"].as_str().map(str::to_owned),
        end_time: v["endTime"].as_str().map(str::to_owned),
        next_day: v["nextDay"].as_bool().unwrap(),
        break_minutes: v["breakMinutes"].as_f64(),
        duration_minutes: v["durationMinutes"].as_f64(),
        credit_minutes: v["creditMinutes"].as_f64(),
    }
}
fn seeded_entries(seed: &Value) -> Vec<ReportEntry> {
    let count = seed["count"].as_u64().unwrap() as usize;
    let days = seed["days"].as_u64().unwrap() as usize;
    (0..count)
        .map(|index| ReportEntry {
            date: format!("2026-11-{:02}", index % days + 1),
            title: if index == 0 {
                format!(
                    "{}🌙{}",
                    "a".repeat(seed["firstTitlePrefix"].as_u64().unwrap() as usize),
                    "b".repeat(seed["firstTitleSuffix"].as_u64().unwrap() as usize)
                )
            } else {
                format!("Dienst {index}")
            },
            kind: if index % 4 == 0 {
                "APPOINTMENT"
            } else {
                "SHIFT"
            }
            .into(),
            type_label: "Dienst".into(),
            color: if index % 2 == 1 {
                "#AaBbCC"
            } else {
                "invalid-color"
            }
            .into(),
            all_day: index % 3 == 0,
            start_time: (index % 3 != 0).then(|| "22:00".into()),
            end_time: (index % 3 != 0).then(|| "06:00".into()),
            next_day: true,
            break_minutes: (index % 5 != 0).then_some(30.0),
            duration_minutes: (index % 7 != 0).then_some(if index % 2 == 1 { 60.0 } else { 7.5 }),
            credit_minutes: (index % 7 != 0).then_some(if index % 3 != 0 { 120.0 } else { 0.0 }),
        })
        .collect()
}
#[test]
fn native_case_plans_are_prepared_for_full_original_html_comparison() {
    let fixture = value_pool::decode(include_str!("../../reference/export-pdf-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 516);
    let mut dump = Vec::new();
    let large = fixture["large"].as_array().unwrap();
    assert_eq!(large.len(), 2);
    for case in cases.iter().chain(large) {
        let raw = &case["input"]["document"];
        let rows = raw["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| ReportRow {
                section: text(v, "section"),
                period: text(v, "period"),
                field: text(v, "field"),
                value: text(v, "value"),
            })
            .collect::<Vec<_>>();
        let mut entries = raw["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(entry)
            .collect::<Vec<_>>();
        if case["input"].get("seed").is_some() {
            entries = seeded_entries(&case["input"]["seed"]);
        }
        let targets =
            serde_json::from_value::<Vec<MonthlyTarget>>(raw["workingTimeTargets"].clone())
                .unwrap();
        let document = ReportDocumentRef {
            period: raw["period"].as_str().unwrap(),
            created_at: raw["createdAt"].as_str().unwrap(),
            rows: &rows,
            entries: &entries,
            targets: &targets,
        };
        let opts = &case["input"]["options"];
        let layout = match opts["layout"].as_str().unwrap() {
            "standard" => PdfLayout::Standard,
            "compact" => PdfLayout::Compact,
            _ => panic!("invalid fixture layout"),
        };
        let plan = plan_pdf(
            &document,
            PdfOptions {
                layout,
                include_salary: opts["includeSalary"].as_bool().unwrap(),
            },
        )
        .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        let actual = serde_json::to_value(plan).unwrap();
        assert_eq!(actual["schemaVersion"], 1);
        if case["input"].get("seed").is_some() {
            assert_eq!(entries.len(), 50000);
            assert!(serde_json::to_vec(&actual).unwrap().len() < 128 * 1024);
            assert!(actual.get("entries").is_none());
            assert!(actual.get("workingTimeTargets").is_none());
            if layout == PdfLayout::Standard {
                assert_eq!(
                    actual["entryPages"][0]["rows"].as_array().unwrap().len(),
                    28
                );
                assert_eq!(actual["entryPages"][0]["rows"][0]["title"][63], 0xd83c);
                assert_eq!(actual["entryPages"][0]["rows"][0]["title"][64], 0x2026);
            }
            // The display is independently owned; raw plan and its long title can go.
            drop(entries);
        }
        dump.push(json!({"id":case["id"],"actual":actual}));
    }
    if let Some(path) = std::env::var_os("LUNA_EXPORT_PDF_DUMP") {
        let path = std::path::PathBuf::from(path);
        assert!(path.is_absolute());
        assert_eq!(
            path.file_name().and_then(|v| v.to_str()),
            Some("export-pdf-native-dump.json")
        );
        let output = json!({"schemaVersion":1,"engineVersion":luna_engine::ENGINE_VERSION,"sourceDigest":fixture["sourceDigest"],"fixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/export-pdf-golden.json"))),"cases":dump});
        let bytes = serde_json::to_vec(&output).unwrap();
        assert!(bytes.len() <= 32 * 1024 * 1024);
        std::fs::write(path, bytes).unwrap();
    }
}
#[test]
fn above_source_budget_and_nonfinite_time_never_become_ready_pdf_plans() {
    let mut entries =
        seeded_entries(&json!({"count":50001,"days":28,"firstTitlePrefix":1,"firstTitleSuffix":0}));
    let rows = Vec::new();
    let targets = Vec::new();
    let options = PdfOptions {
        layout: PdfLayout::Standard,
        include_salary: false,
    };
    let document = ReportDocumentRef {
        period: "2026-11",
        created_at: "2026-11-14",
        rows: &rows,
        entries: &entries,
        targets: &targets,
    };
    assert!(plan_pdf(&document, options).is_err());
    entries.truncate(1);
    entries[0].duration_minutes = Some(f64::NAN);
    let document = ReportDocumentRef {
        period: "2026-11",
        created_at: "2026-11-14",
        rows: &rows,
        entries: &entries,
        targets: &targets,
    };
    assert!(plan_pdf(&document, options).is_err());
}
