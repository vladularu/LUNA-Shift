use luna_engine::runtime::catalog::{self, CatalogLoadError, CatalogOrigin, HistoricalPolicy};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn compiled_preview_is_the_frozen_actual_runtime_and_shares_validated_rules() {
    let data: Value =
        serde_json::from_str(include_str!("../src/rules/embedded-preview.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(
        data["dataSha256"],
        "9f966c6386d3eee4dac19bceceac9e3b9c8f49206ff0e556708c63e94c818032"
    );
    let runtime = catalog::compiled_preview().unwrap();
    assert_eq!(runtime.origin(), CatalogOrigin::CompiledPreview);
    assert_eq!(runtime.generation(), Some(6));
    assert!(!runtime.resolver().is_bundled());
    assert!(Arc::ptr_eq(
        runtime.resolver(),
        catalog::compiled_preview().unwrap().resolver()
    ));
    let resolver = runtime.resolver();
    assert_eq!(
        resolver
            .resolve_tariff("2026-05-01", None)
            .unwrap()
            .package_id,
        "tvoed-vka-bt-k"
    );
    assert_eq!(
        resolver
            .resolve_tariff("2026-04-30", None)
            .unwrap()
            .package_id,
        "tvoed-p-vka-legacy"
    );
    assert_eq!(
        resolver.resolve_legal("2026-01-01").unwrap().package_id,
        "de-arbzg-care"
    );
    assert_eq!(
        resolver.resolve_legal("2025-12-31").unwrap().package_id,
        "de-arbzg-care-legacy"
    );
    assert_eq!(
        resolver.resolve_holiday("2027-12-31").unwrap().package_id,
        "de-holidays"
    );
    // The reviewed 2027 package is deliberately open-ended, not limited by its filename.
    assert_eq!(
        resolver.resolve_holiday("2028-01-01").unwrap().version_id,
        resolver.resolve_holiday("2027-12-31").unwrap().version_id
    );
    assert!(resolver.validate_all_package_semantics().unwrap());
}
#[test]
fn legacy_origin_requires_the_real_compiled_legacy_constructor() {
    let runtime = catalog::compiled_legacy().unwrap();
    assert_eq!(runtime.origin(), CatalogOrigin::CompiledLegacy);
    assert!(runtime.resolver().is_bundled());
    assert!(Arc::ptr_eq(
        runtime.resolver(),
        catalog::compiled_legacy().unwrap().resolver()
    ));
    assert!(runtime.resolver().validate_all_package_semantics().unwrap());
}
#[test]
fn external_catalogs_need_native_full_validation_and_keep_external_identity() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/catalog-validation-golden.json"
    ))
    .unwrap();
    let case = &data["cases"][0];
    let mut manifest = case["input"]["manifest"].clone();
    manifest["generation"] = json!(1.0);
    let packages = case["input"]["packages"].as_array().unwrap();
    let runtime =
        catalog::external(&manifest, packages, HistoricalPolicy::None, BTreeMap::new()).unwrap();
    assert_eq!(runtime.origin(), CatalogOrigin::External);
    assert_eq!(runtime.generation(), Some(1));
    assert!(!runtime.resolver().is_bundled());
    let mut bad = packages.clone();
    bad[0]["rules"]["script"] = json!("return salary * 2");
    assert_eq!(
        catalog::external(
            &manifest,
            &bad,
            HistoricalPolicy::AppCompatibility,
            BTreeMap::new()
        )
        .unwrap_err(),
        CatalogLoadError::InvalidCatalog
    );
}
