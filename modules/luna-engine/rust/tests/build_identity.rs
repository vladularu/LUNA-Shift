#[path = "../build_support/environment.rs"]
mod environment;
#[path = "../build_support/fingerprint.rs"]
mod fingerprint;
#[path = "../build_support/sources.rs"]
mod sources;
#[test]
fn cargo_empty_target_features_are_valid_but_other_missing_identity_fields_are_not() {
    use std::env::VarError;
    let name = "CARGO_CFG_TARGET_FEATURE";
    let absent = environment::build_value(name, Err(VarError::NotPresent)).unwrap();
    let explicit = environment::build_value(name, Ok(String::new())).unwrap();
    assert_eq!(absent, explicit);
    let record = |value: String| vec![(format!("build/{name}"), value.into_bytes())];
    assert_eq!(
        fingerprint::digest(record(absent)).unwrap(),
        fingerprint::digest(record(explicit)).unwrap()
    );
    assert_ne!(
        fingerprint::digest(record(String::new())).unwrap(),
        fingerprint::digest(record("sse2".into())).unwrap()
    );
    for required in ["TARGET", "PROFILE", "OPT_LEVEL", "DEBUG", "CARGO_CFG_PANIC"] {
        assert!(matches!(
            environment::build_value(required, Err(VarError::NotPresent)),
            Err(VarError::NotPresent)
        ));
    }
    let invalid = VarError::NotUnicode(std::ffi::OsString::from("not-a-decoded-value"));
    assert!(matches!(
        environment::build_value(name, Err(invalid)),
        Err(VarError::NotUnicode(_))
    ));
}
#[test]
fn source_and_target_identity_is_part_of_the_actual_engine_version() {
    assert_eq!(luna_engine::ENGINE_BUILD_DIGEST.len(), 64);
    assert!(
        luna_engine::ENGINE_BUILD_DIGEST
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    );
    assert_eq!(
        luna_engine::ENGINE_VERSION,
        format!("luna-engine-v1:{}", luna_engine::ENGINE_BUILD_DIGEST)
    );
    assert_eq!(luna_engine::time_zone::tzdb_version(), Some("2026b"));
}
#[test]
fn fingerprint_is_order_independent_and_has_unambiguous_framing() {
    let a = ("a".to_owned(), b"bc".to_vec());
    let b = ("ab".to_owned(), b"c".to_vec());
    assert_ne!(
        fingerprint::digest([a.clone()]).unwrap(),
        fingerprint::digest([b.clone()]).unwrap()
    );
    assert_eq!(
        fingerprint::digest([a.clone(), b.clone()]).unwrap(),
        fingerprint::digest([b, a.clone()]).unwrap()
    );
    assert!(fingerprint::digest([a.clone(), a]).is_err());
}

#[test]
fn external_standby_table_bytes_change_the_real_production_source_fingerprint() {
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.ancestors().nth(3).unwrap();
    let mut records = sources::source_records(root).unwrap();
    let before = fingerprint::digest(records.clone()).unwrap();
    let table = records
        .iter_mut()
        .find(|(name, _)| name == "src/engine/standby-tables.json")
        .expect("The compiled standby rates must belong to the production identity");
    assert_eq!(
        table.1,
        std::fs::read(root.join("src/engine/standby-tables.json")).unwrap()
    );
    table.1.push(b' ');
    assert_ne!(before, fingerprint::digest(records).unwrap());
}
