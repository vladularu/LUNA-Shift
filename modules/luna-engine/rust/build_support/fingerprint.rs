use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io};
/// Length framing distinguishes paths and contents without depending on JSON
/// key order, platform separators or absolute checkout locations.
pub fn digest(records: impl IntoIterator<Item = (String, Vec<u8>)>) -> io::Result<String> {
    let mut unique = BTreeMap::new();
    for (name, bytes) in records {
        if unique.insert(name, bytes).is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Duplicate engine fingerprint input",
            ));
        }
    }
    let mut hash = Sha256::new();
    hash.update(b"luna-engine-source-build-v1\0");
    for (name, bytes) in unique {
        hash.update((name.len() as u64).to_be_bytes());
        hash.update(name.as_bytes());
        hash.update((bytes.len() as u64).to_be_bytes());
        hash.update(&bytes);
    }
    Ok(format!("{:x}", hash.finalize()))
}
