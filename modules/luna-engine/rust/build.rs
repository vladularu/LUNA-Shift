#[path = "build_support/environment.rs"]
mod environment;
#[path = "build_support/fingerprint.rs"]
mod fingerprint;
#[path = "build_support/sources.rs"]
mod sources;
use std::{env, fs, path::PathBuf, process::Command};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("Missing manifest directory")?);
    let root = manifest
        .ancestors()
        .nth(3)
        .ok_or("Invalid engine source layout")?;
    let mut records = sources::source_records(root)?;
    for relative in sources::SOURCE_DIRS
        .iter()
        .chain(sources::EXTRA_SOURCE_FILES)
    {
        println!("cargo:rerun-if-changed={}", root.join(relative).display());
    }
    let compiler = Command::new(env::var_os("RUSTC").ok_or("Missing Rust compiler")?)
        .arg("-vV")
        .output()?;
    if !compiler.status.success() {
        return Err("Cannot identify Rust compiler".into());
    }
    records.push(("build/compiler".to_owned(), compiler.stdout));
    for name in [
        "TARGET",
        "PROFILE",
        "OPT_LEVEL",
        "DEBUG",
        "CARGO_CFG_TARGET_FEATURE",
        "CARGO_CFG_PANIC",
    ] {
        records.push((
            format!("build/{name}"),
            environment::build_value(name, env::var(name))?.into_bytes(),
        ));
    }
    let mut features: Vec<_> = env::vars()
        .filter(|(key, _)| key.starts_with("CARGO_FEATURE_"))
        .collect();
    features.sort();
    for (name, value) in features {
        records.push((format!("build/{name}"), value.into_bytes()));
    }
    let digest = fingerprint::digest(records)?;
    let output = PathBuf::from(env::var_os("OUT_DIR").ok_or("Missing output directory")?)
        .join("engine_identity.rs");
    fs::write(
        output,
        format!(
            "pub const ENGINE_BUILD_DIGEST: &str = \"{digest}\";\npub const ENGINE_VERSION: &str = \"luna-engine-v1:{digest}\";\n"
        ),
    )?;
    Ok(())
}
