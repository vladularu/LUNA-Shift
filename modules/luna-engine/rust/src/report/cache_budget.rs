//! Bound retained serialized output without allocating a second JSON buffer.
use serde::Serialize;
use std::io::{self, Write};
struct Counter {
    bytes: u64,
    limit: u64,
}
impl Write for Counter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes = self.bytes.saturating_add(bytes.len() as u64);
        if self.bytes > self.limit {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "cache item limit",
            ));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(crate) fn serialized_bytes<T: Serialize>(value: &T, limit: u64) -> Option<u64> {
    let mut counter = Counter { bytes: 0, limit };
    serde_json::to_writer(&mut counter, value).ok()?;
    Some(counter.bytes)
}
