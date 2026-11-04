import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedBaselineFromReceipt } from "./accept-testflight-baseline.mjs";
import { inventoryDigest } from "./testflight-baseline.mjs";
const id = "00000000-0000-4000-8000-000000000001",
  hash = "a".repeat(64);
function fixture() {
  const files = [{ path: "src/widget.ts", sha256: hash }],
    digest = inventoryDigest(files);
  return {
    plan: { sourceInventory: files, sourceDigest: digest, createdAt: "2026-11-04T10:00:00Z" },
    result: {
      published: true,
      dryRun: false,
      channel: "production",
      platform: "ios",
      build: 9,
      projectId: id,
      buildId: id,
      runtime: "b".repeat(40),
      sourceDigest: digest,
      update: { id, group: id },
      delivery: {
        httpStatus: 200,
        updateId: id,
        group: id,
        bundleSha256: hash,
        assetsVerified: 1,
        verified: [
          { kind: "asset", key: "asset", sha256: hash },
          { kind: "bundle", key: "bundle", sha256: hash },
        ],
      },
    },
    evidence: {
      status: "accepted",
      build: 9,
      updateId: id,
      sourceDigest: digest,
      date: "2026-11-04",
      quote: "Alle vier Flows auf iPhone getestet",
      flows: { calendar: "passed", widgets: "passed", netPay: "passed", invitation: "passed" },
    },
  };
}
test("records the frozen published source and verified assets after full device acceptance", () => {
  const { plan, result, evidence } = fixture(),
    baseline = acceptedBaselineFromReceipt(plan, result, evidence);
  assert.deepEqual(baseline.files, plan.sourceInventory);
  assert.equal(baseline.updateId, id);
  assert.equal(baseline.assets.length, 1);
});
for (const name of ["calendar", "widgets", "netPay", "invitation"]) {
  test("partial device acceptance cannot replace the complete baseline: " + name, () => {
    const { plan, result, evidence } = fixture();
    evidence.flows[name] = "pending";
    assert.throws(() => acceptedBaselineFromReceipt(plan, result, evidence));
  });
}
test("rejects another update, another source, an unverified delivery or evidence predating the release", () => {
  for (const mutate of [
    (f) => (f.evidence.updateId = id.replace(/1$/, "2")),
    (f) => (f.plan.sourceInventory[0].sha256 = "c".repeat(64)),
    (f) => (f.result.delivery.httpStatus = 500),
    (f) => f.result.delivery.verified.pop(),
    (f) => (f.result.published = false),
    (f) => (f.result.dryRun = true),
    (f) => (f.evidence.date = "2026-11-03"),
    (f) => (f.evidence.quote = ""),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => acceptedBaselineFromReceipt(f.plan, f.result, f.evidence));
  }
});
