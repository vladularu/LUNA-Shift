use super::{
    ValidationError, ValidationIssue,
    common::*,
    schema::{SchemaKind, validate_schema},
};
use serde_json::Value;
fn track_key(value: &Value) -> String {
    format!("{}:{}", s(value, "packageId"), s(value, "kind"))
}
fn identity(value: &Value) -> String {
    format!("{}:{}", s(value, "packageId"), s(value, "versionId"))
}
pub fn validate_manifest(value: &Value) -> Result<Vec<ValidationIssue>, ValidationError> {
    let mut issues = validate_schema(SchemaKind::Manifest, value)?;
    if !issues.is_empty() {
        return Ok(issues);
    }
    let tracks = a(&value["tracks"]);
    let packages = a(&value["packages"]);
    let tariffs: Vec<_> = tracks.iter().filter(|v| v["kind"] == "TARIFF").collect();
    if value["schemaVersion"] == 1 && tariffs.len() > 1 {
        issue(
            &mut issues,
            "MULTI_TARIFF_REQUIRES_V2",
            "/tracks",
            "Multiple tariff tracks require manifest schema v2.",
        );
    }
    if value["schemaVersion"] == 2
        && !tariffs
            .iter()
            .any(|track| track["packageId"] == value["legacyTariffPackageId"])
    {
        issue(
            &mut issues,
            "INVALID_LEGACY_TARIFF",
            "/legacyTariffPackageId",
            "The legacy tariff must reference a tariff track in this manifest.",
        );
    }
    if !real_utc(s(value, "publishedAt")) {
        issue(
            &mut issues,
            "INVALID_TIMESTAMP",
            "/publishedAt",
            "publishedAt must be a real UTC timestamp.",
        );
    }
    if !value["rollbackOfGeneration"].is_null()
        && n(value, "rollbackOfGeneration") >= n(value, "generation")
    {
        issue(
            &mut issues,
            "INVALID_ROLLBACK_GENERATION",
            "/rollbackOfGeneration",
            "A rollback must point to an earlier generation.",
        );
    }
    let keys: Vec<_> = tracks.iter().map(track_key).collect();
    duplicates(
        keys.iter().map(String::as_str),
        "/tracks",
        "track",
        &mut issues,
    );
    let identities: Vec<_> = packages.iter().map(identity).collect();
    duplicates(
        identities.iter().map(String::as_str),
        "/packages",
        "package identity",
        &mut issues,
    );
    duplicates(
        packages.iter().map(|v| s(v, "path")),
        "/packages",
        "package path",
        &mut issues,
    );
    // JS Map retains the first key position and the last duplicate value.
    let mut unique: Vec<(String, &Value)> = vec![];
    for track in tracks {
        let key = track_key(track);
        if let Some((_, entry)) = unique.iter_mut().find(|(k, _)| k == &key) {
            *entry = track;
        } else {
            unique.push((key, track));
        }
    }
    for (i, track) in tracks.iter().enumerate() {
        range(
            s(track, "coverageFrom"),
            &track["coverageTo"],
            &format!("/tracks/{i}"),
            &mut issues,
        );
    }
    for (i, descriptor) in packages.iter().enumerate() {
        range(
            s(descriptor, "validFrom"),
            &descriptor["validTo"],
            &format!("/packages/{i}"),
            &mut issues,
        );
        if !unique.iter().any(|(key, _)| key == &track_key(descriptor)) {
            issue(
                &mut issues,
                "MISSING_TRACK",
                format!("/packages/{i}"),
                format!(
                    "No matching track for {} ({}).",
                    s(descriptor, "packageId"),
                    s(descriptor, "kind")
                ),
            );
        }
    }
    for (key, track) in unique {
        let mut descriptors: Vec<_> = packages.iter().filter(|v| track_key(v) == key).collect();
        descriptors.sort_by(|left, right| s(left, "validFrom").cmp(s(right, "validFrom")));
        if descriptors.is_empty() {
            issue(
                &mut issues,
                "EMPTY_TRACK",
                "/tracks",
                format!("Track {key} has no packages."),
            );
            continue;
        }
        for descriptor in &descriptors {
            if s(descriptor, "validFrom") < s(track, "coverageFrom")
                || track["coverageTo"].as_str().is_some_and(|end| {
                    descriptor["validTo"].is_null() || s(descriptor, "validTo") > end
                })
            {
                issue(
                    &mut issues,
                    "PACKAGE_OUTSIDE_TRACK",
                    "/packages",
                    format!("Package {} exceeds track {key}.", identity(descriptor)),
                );
            }
        }
        for pair in descriptors.windows(2) {
            if pair[0]["validTo"].is_null() || s(pair[1], "validFrom") <= s(pair[0], "validTo") {
                issue(
                    &mut issues,
                    "OVERLAPPING_PACKAGE_RANGE",
                    "/packages",
                    format!("Packages overlap in track {key}."),
                );
            }
        }
        if track["coverage"] == "COMPLETE" {
            if descriptors[0]["validFrom"] != track["coverageFrom"] {
                issue(
                    &mut issues,
                    "INCOMPLETE_TRACK_START",
                    "/packages",
                    format!("Track {key} does not start at coverageFrom."),
                );
            }
            for pair in descriptors.windows(2) {
                if pair[0]["validTo"].is_null()
                    || next_date(s(pair[0], "validTo")).as_deref() != Some(s(pair[1], "validFrom"))
                {
                    issue(
                        &mut issues,
                        "INCOMPLETE_TRACK_GAP",
                        "/packages",
                        format!("Track {key} contains a validity gap."),
                    );
                }
            }
            if descriptors.last().unwrap()["validTo"] != track["coverageTo"] {
                issue(
                    &mut issues,
                    "INCOMPLETE_TRACK_END",
                    "/packages",
                    format!("Track {key} does not end at coverageTo."),
                );
            }
        }
    }
    Ok(issues)
}
pub fn validate_publication(value: &Value) -> Result<Vec<ValidationIssue>, ValidationError> {
    let mut issues = validate_schema(SchemaKind::Publication, value)?;
    if !issues.is_empty() {
        return Ok(issues);
    }
    if !real_utc(s(value, "publishedAt")) {
        issue(
            &mut issues,
            "INVALID_TIMESTAMP",
            "/publishedAt",
            "publishedAt must be a real UTC timestamp.",
        );
    }
    if !value["rollbackOfGeneration"].is_null()
        && n(value, "rollbackOfGeneration") >= n(value, "generation")
    {
        issue(
            &mut issues,
            "INVALID_ROLLBACK_GENERATION",
            "/rollbackOfGeneration",
            "A rollback must point to an earlier generation.",
        );
    }
    let prefix = if value["channel"] == "PREVIEW" {
        "preview-"
    } else {
        "production-"
    };
    if !s(&value["signing"], "keyId").starts_with(prefix) {
        issue(
            &mut issues,
            "SIGNING_KEY_CHANNEL_MISMATCH",
            "/signing/keyId",
            format!("{} key IDs must start with {prefix}.", s(value, "channel")),
        );
    }
    Ok(issues)
}

/// Structural/semantic catalog validation. Signature authentication is a
/// separate platform gate; this function never downloads or activates data.
pub fn validate_rule_catalog(
    manifest: &Value,
    packages: &[Value],
) -> Result<Vec<ValidationIssue>, ValidationError> {
    let mut issues = validate_manifest(manifest)?;
    if !issues.is_empty() {
        return Ok(issues);
    }
    for (i, package) in packages.iter().enumerate() {
        for mut entry in super::validate_rule_package(package)? {
            entry.path = format!(
                "/catalogPackages/{i}{}",
                if entry.path == "/" { "" } else { &entry.path }
            );
            issues.push(entry);
        }
    }
    if !issues.is_empty() {
        return Ok(issues);
    }
    let mut by_identity = std::collections::BTreeMap::new();
    for package in packages {
        by_identity.insert(identity(package), package);
    }
    if by_identity.len() != packages.len() {
        issue(
            &mut issues,
            "DUPLICATE_PACKAGE",
            "/catalogPackages",
            "Package identities must be unique.",
        );
    }
    if packages.len() != a(&manifest["packages"]).len() {
        issue(
            &mut issues,
            "CATALOG_SIZE_MISMATCH",
            "/catalogPackages",
            "Catalog packages must match manifest descriptors exactly.",
        );
    }
    for (i, descriptor) in a(&manifest["packages"]).iter().enumerate() {
        let Some(package) = by_identity.get(&identity(descriptor)) else {
            issue(
                &mut issues,
                "MISSING_CATALOG_PACKAGE",
                format!("/packages/{i}"),
                format!("Missing package {}.", identity(descriptor)),
            );
            continue;
        };
        if package["kind"] != descriptor["kind"]
            || n(package, "engineContractVersion") != n(descriptor, "engineContractVersion")
            || package["validFrom"] != descriptor["validFrom"]
            || package["validTo"] != descriptor["validTo"]
        {
            issue(
                &mut issues,
                "DESCRIPTOR_PACKAGE_MISMATCH",
                format!("/packages/{i}"),
                format!("Descriptor metadata differs from {}.", identity(descriptor)),
            );
        }
        if package["status"] != "PUBLISHED" {
            issue(
                &mut issues,
                "UNPUBLISHED_CATALOG_PACKAGE",
                format!("/catalogPackages/{i}/status"),
                "Only PUBLISHED packages may appear in a signed catalog.",
            );
        }
    }
    Ok(issues)
}
