# Local Picomatch repeated-extglob hardening

## Why this is local maintenance

On 2026-11-17 npm audit reports GHSA-fc5q-39xc-vjpf (CVE-2026-112366) against Picomatch through 4.0.7. [GitHub's reviewed advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) was published on 2026-10-19, reviewed/updated on 2026-11-17 and lists no patched version. [Snyk's entry](https://security.snyk.io/vuln/SNYK-JS-PICOMATCH-21248802) for the same CVE is revoked: Snyk judged it not a vulnerability and records the maintainer's dispute.

[Upstream proposal 235](https://github.com/micromatch/picomatch/pull/235), by ShlomoRussell, commit `0150ed18b7971894bfd1824c8f96d6b63c70ad1f`, was closed on 2026-10-21 without merging. The maintainer advises avoiding risky patterns and untrusted regular expressions. This project uses that public proposal as a reviewed starting point for local performance hardening. It is **not an official patch or a claim that upstream approved the proposal**. Picomatch is MIT licensed; the installed sources retain their license.

## Scope and behavior

The patch uses Picomatch's existing risky-extglob literalization path. Repeated `+()`/`*()` extglobs containing an unescaped glob star outside a character class or quoted literal compile as literal text, including single-branch forms. Whole-string repetition overlap between literal branches is also detected. Such patterns intentionally stop behaving as wildcard expressions; they match their literal spelling. Normal file globs and ordinary alternatives remain supported.

Local review changes relative to proposal 235:

- Keep the original same-character prefix-overlap guard. Replacing it would lose existing protection for different-length repetitions where neither length divides the other.
- Scan the complete body, respecting escaped characters, quoted literals, character classes, unmatched opening brackets and `nobracket: true`. Do not treat the `*` in a nested `*(...)` as an ordinary glob star.
- Preserve the installed versions' existing nested-extglob reductions. This patch does not backport unrelated semantic changes between Picomatch 2 and 4.

The existing explicit `maxExtglobRecursion: false` opt-out is preserved for trusted callers. This is a bounded mitigation of the advisory's cases, not a general guarantee about arbitrary regular expressions or attacker-controlled glob languages. No application UI, calculation, stored data, Expo version, native binary or release channel changes are included.

## Reproducible installation and evidence

`scripts/picomatch-hardening.patch.json` records the exact six package-lock locations, versions 2.3.2/4.0.5/4.0.7, npm archive identities, eight consumer resolutions, original/postimage SHA-256 hashes of every JavaScript file and package metadata, and deterministic edits to `lib/parse.js`. The installer pins the manifest's own hash. All original inputs and all calculated postimages must validate before any write. Unknown/mixed installations fail; applying the patch to an already verified installation is idempotent.

Postinstall applies the patch after the existing hardenings. `verify:fast` and both audit runners verify it independently. Evidence requires actual installed postimages, exact lock identity, all expected executable files, consumer resolutions and paths inside the checkout. Dependency symlinks/junctions to another checkout are rejected. Opaque proof objects are bound to the verifier's checkout and revalidate source bytes when used; copying/serializing an object cannot provide evidence.

The existing decoder CLI delegates to the Picomatch CLI after its existing Zod check; imported decoder helpers remain independent. The existing audit-policy test entry imports the new regression suite. Package scripts, package-lock and reviewed release-source metadata remain byte-equivalent to the Preview predecessor. This preserves the `packageJson:scripts` fingerprint input instead of introducing a native-runtime change for tooling maintenance.

The audit policy recognizes only source 1247710, the exact GHSA URL, package, dependency, title, high severity and affected range, with exactly the four production nodes or all six nodes. The raw npm finding stays visible as mitigated. Missing evidence, drift, another advisory, duplicate/missing/unknown report nodes, or a future version remains blocking. Snyk's revocation alone does not authorize an exception.

The current npm report also exposes an existing audit traversal problem: cloning the visited set per edge enumerates many shared paths through cyclic meta dependencies. Each root traversal now shares its visited set, visits each reachable package once and retains every reachable advisory. A layered cyclic regression checks bounded work and preservation of multiple findings; an unresolvable cycle remains blocking. Both audit scopes use this same traversal.

## Validation and removal

Run `npm ci`, `npm run test:audit-policy`, `npm run audit:production`, `npm run audit:all` and `npm run verify:fast`; all PR CI jobs must pass before merge. Regression tests cover the cited forms across all six installations, existing overlap protection, normal Expo/Jest globs, parser options, idempotence, lock/source/manifest tampering, external dependency paths, stale/forged evidence and audit-policy boundaries. Tests execute bounded matching only after installed-source verification; no unpatched expensive pattern is executed.

When an official compatible release exists, review its behavior, upgrade the dependency graph and remove this local patch plus the exact mitigation policy in the same tested change. Do not automatically extend these hashes or the advisory identity to new versions. This maintenance does not publish an OTA or claim new iPhone acceptance.
