#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, ImmutableSnapshot, ValidatedRequest},
    rules::RuleKind,
    runtime::{
        catalog::{self, CatalogOrigin},
        catalog_artifact::{ArtifactError, MAX_ARTIFACT_BYTES, RuleArtifact},
        catalog_source::{self, CatalogSourceError},
        sources::SourceReadError,
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;

fn parsed(mut raw: Value) -> ImmutableSnapshot {
    snapshot::seal(&mut raw);
    let request = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    match contract::parse_request(&serde_json::to_vec(&request).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
        _ => panic!("registration expected"),
    }
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":0,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn compiled() -> Value {
    let mut raw = snapshot::raw_snapshot(1, "owner", 1);
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    raw
}
fn payload<'a>(raw: &'a mut Value, kind: &str) -> &'a mut Value {
    &mut raw["catalogs"]["current"][kind]["payload"]["data"]["value"]
}
fn chunks(text: &str) -> Value {
    // Preserve complete UTF-8 characters when crossing the transport string cap.
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if current.len() + ch.len_utf8() > 60_000 {
            chunks.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    chunks.push(current);
    json!(chunks)
}

#[test]
fn decoded_artifact_nodes_share_one_catalog_budget_before_semantic_validation() {
    // Each artifact is independently below the original byte/node limits.
    // Their decoded trees must not accumulate twenty independent allowances.
    let text = format!("[{}]", vec!["null"; 100_000].join(","));
    assert!(text.len() < MAX_ARTIFACT_BYTES);
    let package_chunks = chunks(&text);
    let mut raw = compiled();
    *payload(&mut raw, "tariff") = json!({
        "mode":"EXTERNAL", "packageJsonChunks":vec![package_chunks;20],
        "manifestJsonChunks":["null"], "historicalPolicy":"NONE", "collationRanks":{}
    });
    for kind in ["legal", "holiday"] {
        *payload(&mut raw, kind) = json!({"mode":"EXTERNAL","packageJsonChunks":[]});
    }
    let snapshot = parsed(raw);
    let error = match catalog_source::prepare_catalog_set(snapshot.current_catalog(), 0) {
        Ok(_) => panic!("oversized decoded catalog accepted"),
        Err(error) => error,
    };
    assert_eq!(format!("{error:?}"), "Artifact(TooManyDecodedNodes)");
}
fn external(whitespace: bool) -> Value {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/catalog-validation-golden.json"
    ))
    .unwrap();
    let input = &fixture["cases"][0]["input"];
    let mut manifest = input["manifest"].clone();
    let mut parts = [Vec::new(), Vec::new(), Vec::new()];
    for package in input["packages"].as_array().unwrap() {
        let mut text = serde_json::to_string(package).unwrap();
        if whitespace {
            text = format!(" \n{text}\r\n ");
        }
        let descriptor = manifest["packages"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|v| {
                v["packageId"] == package["packageId"] && v["versionId"] == package["versionId"]
            })
            .unwrap();
        descriptor["sizeBytes"] = json!(text.len());
        descriptor["sha256"] = json!(format!("{:x}", Sha256::digest(text.as_bytes())));
        let target = match package["kind"].as_str().unwrap() {
            "TARIFF" => 0,
            "LEGAL" => 1,
            "HOLIDAY" => 2,
            _ => unreachable!(),
        };
        parts[target].push(chunks(&text));
    }
    let ranks: Value = serde_json::from_str::<Value>(include_str!(
        "../../reference/catalog-source-collation.json"
    ))
    .unwrap()["collationRanks"]
        .clone();
    let mut raw = compiled();
    for (index, kind) in ["tariff", "legal", "holiday"].into_iter().enumerate() {
        let mut part = json!({"mode":"EXTERNAL","packageJsonChunks":parts[index]});
        if index == 0 {
            part["manifestJsonChunks"] = chunks(&serde_json::to_string(&manifest).unwrap());
            part["historicalPolicy"] = json!("APP_COMPATIBILITY");
            part["collationRanks"] = ranks.clone();
        }
        *payload(&mut raw, kind) = part;
    }
    raw
}
#[test]
fn compiled_catalogs_bind_actual_native_presets_and_reuse_their_storage() {
    let snapshot = parsed(compiled());
    let runtime = catalog_source::from_snapshot(&snapshot).unwrap();
    assert_eq!(runtime.origin(), CatalogOrigin::CompiledPreview);
    assert!(Arc::ptr_eq(
        runtime.resolver(),
        catalog::compiled_preview().unwrap().resolver()
    ));
    assert!(!runtime.resolver().is_bundled());
    // Source groups unrelated to rule acquisition remain explicitly unrequested.
    assert!(matches!(
        snapshot.sources()[0].state(),
        contract::SourceState::NotRequested
    ));
    let mut raw = compiled();
    raw["catalogs"]["current"]["selectedPackageIds"]["tariff"] = json!(["tvoed-p-vka-legacy"]);
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::SelectionMismatch
    );
}
#[test]
fn prepared_native_catalogs_derive_defaults_before_selection_and_share_one_candidate_index() {
    for mode in ["COMPILED_PREVIEW", "COMPILED_LEGACY"] {
        let mut raw = compiled();
        raw["catalogs"]["current"]["selectedPackageIds"] =
            json!({"tariff":[],"legal":[],"holiday":[]});
        for kind in ["tariff", "legal", "holiday"] {
            *payload(&mut raw, kind) = json!({"mode":mode});
        }
        let input = parsed(raw);
        let prepared = catalog_source::prepare_catalog_set(input.current_catalog(), 0).unwrap();
        assert!(!prepared.requires_ranks());
        assert!(prepared.candidates().unwrap().is_empty());
        assert!(!prepared.default_package_ids().tariff.is_empty());
        let expected = if mode == "COMPILED_PREVIEW" {
            catalog::compiled_preview().unwrap()
        } else {
            catalog::compiled_legacy().unwrap()
        };
        let finished = prepared.finish(Default::default()).unwrap();
        assert!(Arc::ptr_eq(finished.resolver(), expected.resolver()));
    }
    let mut raw = external(true);
    payload(&mut raw, "tariff")["collationRanks"] = json!({});
    raw["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":[],"legal":[],"holiday":[]});
    let input = parsed(raw);
    let prepared = catalog_source::prepare_catalog_set(input.current_catalog(), 0).unwrap();
    assert!(prepared.requires_ranks());
    assert!(std::ptr::eq(
        prepared.candidates().unwrap(),
        prepared.candidates().unwrap()
    ));
    assert!(prepared.candidates().unwrap().contains("NATIONWIDE"));
    let ranks = prepared
        .candidates()
        .unwrap()
        .iter()
        .map(|name| (name.clone(), 0))
        .collect();
    let runtime = prepared.finish(ranks).unwrap();
    assert_eq!(runtime.origin(), CatalogOrigin::External);
    assert!(!runtime.resolver().is_bundled());
    let prepared = catalog_source::prepare_catalog_set(input.current_catalog(), 0).unwrap();
    assert!(matches!(
        prepared.finish(Default::default()),
        Err(CatalogSourceError::MissingCollation)
    ));
}

#[test]
fn annual_tie_preflight_requires_platform_version_order_only_for_equal_starts() {
    use luna_engine::runtime::catalog::HistoricalPolicy;
    let packages = json!([
        {"kind":"TARIFF","packageId":"same","validFrom":"2026-01-01","versionId":"é"},
        {"kind":"TARIFF","packageId":"same","validFrom":"2026-01-01","versionId":"é"},
        {"kind":"TARIFF","packageId":"same","validFrom":"2027-01-01","versionId":"later"},
        {"kind":"TARIFF","packageId":"different","validFrom":"2026-01-01","versionId":"other"}
    ]);
    let candidates = catalog_source::required_collation_candidates(
        packages.as_array().unwrap(),
        HistoricalPolicy::None,
    )
    .unwrap();
    assert!(candidates.contains("é") && candidates.contains("é"));
    assert!(!candidates.contains("later") && !candidates.contains("other"));
}
#[test]
fn acquisition_states_modes_and_history_are_never_silently_replaced() {
    for (state, expected) in [
        (json!({"state":"LOADING"}), SourceReadError::Loading),
        (
            json!({"state":"NOT_REQUESTED"}),
            SourceReadError::NotRequested,
        ),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            SourceReadError::Failed(contract::SourceFailure::ReadFailed),
        ),
    ] {
        let mut raw = compiled();
        raw["catalogs"]["current"]["legal"] = state;
        assert_eq!(
            catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
            CatalogSourceError::Source {
                kind: RuleKind::Legal,
                error: expected
            }
        );
    }
    let mut raw = compiled();
    payload(&mut raw, "legal")["mode"] = json!("COMPILED_LEGACY");
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::MixedModes
    );
    let mut raw = compiled();
    payload(&mut raw, "tariff")["verified"] = json!(true);
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::MalformedPart(RuleKind::Tariff)
    );
    let mut raw = compiled();
    let current = raw["catalogs"]["current"].clone();
    raw["catalogs"]["history"] = json!([{"catalog":current,"compatiblePackageIds":{"tariff":[],"legal":[],"holiday":[]},"validBefore":{"tariff":{"kind":"MISSING"},"legal":{"kind":"MISSING"},"holiday":{"kind":"MISSING"}}}]);
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::UnsupportedHistory
    );
}
#[test]
fn external_original_bytes_descriptors_semantics_and_history_are_bound_natively() {
    for whitespace in [false, true] {
        let raw = external(whitespace);
        let runtime = catalog_source::from_snapshot(&parsed(raw)).unwrap();
        assert_eq!(runtime.origin(), CatalogOrigin::External);
        assert_eq!(runtime.generation(), Some(1));
        assert!(!runtime.resolver().is_bundled());
        assert_eq!(
            runtime
                .resolver()
                .resolve_tariff("2026-05-01", None)
                .unwrap()
                .package_id,
            "tvoed-vka-bt-k"
        );
        assert_eq!(
            runtime
                .resolver()
                .resolve_tariff("2026-04-30", None)
                .unwrap()
                .package_id,
            "tvoed-p-vka-legacy"
        );
    }
    let mut raw = external(false);
    payload(&mut raw, "tariff")["historicalPolicy"] = json!("NONE");
    let runtime = catalog_source::from_snapshot(&parsed(raw)).unwrap();
    assert!(
        runtime
            .resolver()
            .resolve_tariff("2026-04-30", None)
            .is_err()
    );
}
#[test]
fn external_mutations_cannot_reuse_old_hashes_or_fabricated_collation() {
    let mut raw = external(false);
    let original = payload(&mut raw, "tariff")["packageJsonChunks"][0][0]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(original.contains("\"status\":\"PUBLISHED\""));
    payload(&mut raw, "tariff")["packageJsonChunks"][0][0] =
        json!(original.replacen("\"status\":\"PUBLISHED\"", "\"status\":\"pUBLISHED\"", 1));
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::Artifact(ArtifactError::PackageHash)
    );
    let mut raw = external(false);
    let original = payload(&mut raw, "tariff")["packageJsonChunks"][0][0]
        .as_str()
        .unwrap()
        .to_owned();
    payload(&mut raw, "tariff")["packageJsonChunks"][0][0] = json!(format!(" {original}"));
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::Artifact(ArtifactError::PackageSize)
    );
    let mut raw = external(false);
    payload(&mut raw, "tariff")["collationRanks"] = json!({});
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::MissingCollation
    );
    let mut raw = external(false);
    let tariff_artifacts = payload(&mut raw, "tariff")["packageJsonChunks"].clone();
    let legal_artifacts = payload(&mut raw, "legal")["packageJsonChunks"].clone();
    payload(&mut raw, "tariff")["packageJsonChunks"] = legal_artifacts;
    payload(&mut raw, "legal")["packageJsonChunks"] = tariff_artifacts;
    assert_eq!(
        catalog_source::from_snapshot(&parsed(raw)).unwrap_err(),
        CatalogSourceError::Artifact(ArtifactError::PackageKind)
    );
}
#[test]
fn artifact_limits_duplicate_keys_and_unicode_byte_lengths_are_checked() {
    let value = RuleArtifact::from_chunks(&json!(["{\"text\":\"ä", "😀\"}"])).unwrap();
    assert_eq!(value.value()["text"], "ä😀");
    assert_eq!(value.byte_length(), "{\"text\":\"ä😀\"}".len());
    for raw in [json!([]), json!([1]), json!(["x".repeat(65_537)])] {
        assert_eq!(
            RuleArtifact::from_chunks(&raw).unwrap_err(),
            ArtifactError::InvalidChunks
        );
    }
    assert_eq!(
        RuleArtifact::from_chunks(&json!(["{\"x\":1,\"x\":2}"])).unwrap_err(),
        ArtifactError::InvalidJson
    );
    assert_eq!(
        RuleArtifact::from_chunks(&json!(["{\"x\":1e999}"])).unwrap_err(),
        ArtifactError::InvalidJson
    );
    let over_limit: Vec<String> = (0..9).map(|_| " ".repeat(65_536)).collect();
    assert!(over_limit.iter().map(String::len).sum::<usize>() > MAX_ARTIFACT_BYTES);
    assert_eq!(
        RuleArtifact::from_chunks(&json!(over_limit)).unwrap_err(),
        ArtifactError::TooLarge
    );
}
