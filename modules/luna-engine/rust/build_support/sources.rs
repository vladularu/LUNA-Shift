//! Shared production build inventory, exercised directly by identity tests.
use std::{fs, io, path::Path};
pub const SOURCE_DIRS: &[&str] = &[
    "modules/luna-engine/rust/src",
    "modules/luna-engine/rust/build_support",
];
pub const EXTRA_SOURCE_FILES: &[&str] = &[
    "modules/luna-engine/rust/build.rs",
    "modules/luna-engine/rust/Cargo.toml",
    "modules/luna-engine/rust/Cargo.lock",
    "modules/luna-engine/rust/rust-toolchain.toml",
    "modules/luna-engine/rust/include/LunaEngine.h",
    "rules/schema/manifest.schema.json",
    "rules/schema/rule-package.schema.json",
    "rules/schema/publication-request.schema.json",
    "rules/schema/production-channel-config.schema.json",
    "src/rules/simple-tariff-table-layout.json",
    "src/engine/standby-tables.json",
];
fn collect_files(root: &Path, path: &Path, records: &mut Vec<(String, Vec<u8>)>) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Symlink in engine fingerprint source",
        ));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            collect_files(root, &entry?.path(), records)?;
        }
    } else if path.extension().is_some_and(|e| e == "rs" || e == "json") {
        let relative = path
            .strip_prefix(root)
            .map_err(io::Error::other)?
            .to_str()
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "Invalid engine source path")
            })?
            .replace('\\', "/");
        records.push((relative, fs::read(path)?));
    }
    Ok(())
}
pub fn source_records(root: &Path) -> io::Result<Vec<(String, Vec<u8>)>> {
    let mut records = Vec::new();
    for relative in SOURCE_DIRS {
        collect_files(root, &root.join(relative), &mut records)?;
    }
    for relative in EXTRA_SOURCE_FILES {
        records.push(((*relative).to_owned(), fs::read(root.join(relative))?));
    }
    Ok(records)
}
