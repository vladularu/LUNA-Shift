import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAuditReport } from "./audit-production.mjs";
import { verifyBracesHardening } from "./braces-hardening.mjs";
import decoderHardening from "./decode-uri-component-hardening.cjs";
import { verifyNodeForgeHardening } from "./node-forge-hardening.mjs";
import { verifyZodHardening } from "./zod-hardening.mjs";

const severities = ["info", "low", "moderate", "high", "critical"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const findingKey = (finding) =>
  `${finding.source ?? "unknown"}:${finding.name}:${finding.url ?? ""}`;

export function evaluateDependencyAuditReport(report, proofs = []) {
  if (
    !isRecord(report) ||
    report.auditReportVersion !== 2 ||
    report.error ||
    !isRecord(report.vulnerabilities)
  ) {
    throw new Error("npm audit lieferte keinen vollständigen Vulnerability-Report.");
  }

  const packages = Object.entries(report.vulnerabilities);
  for (const [name, value] of packages) {
    if (
      !isRecord(value) ||
      !severities.includes(value.severity) ||
      !Array.isArray(value.via) ||
      !Array.isArray(value.nodes) ||
      value.nodes.some((node) => typeof node !== "string")
    ) {
      throw new Error(`Ungültiger Audit-Eintrag für ${name}.`);
    }
    for (const cause of value.via) {
      if (typeof cause === "string") {
        if (!Object.hasOwn(report.vulnerabilities, cause)) {
          throw new Error(`Unaufgelöste Audit-Abhängigkeit von ${name}.`);
        }
      } else if (
        !isRecord(cause) ||
        !severities.includes(cause.severity) ||
        typeof cause.name !== "string" ||
        typeof cause.title !== "string" ||
        typeof cause.url !== "string" ||
        severities.indexOf(cause.severity) > severities.indexOf(value.severity)
      ) {
        throw new Error(`Ungültige Advisory für ${name}.`);
      }
    }
  }

  // Keep the existing, identity-bound backport checks as the only mitigation policy.
  const evaluation = evaluateAuditReport(report, ...proofs);
  const mitigated = new Set(evaluation.mitigated.map(findingKey));
  const blocking = new Set(evaluation.blocking.map(findingKey));
  const advisories = new Map();
  const packageCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, value] of packages) {
    packageCounts[value.severity] += 1;
    for (const cause of value.via) {
      if (typeof cause === "string") continue;
      const key = findingKey(cause);
      const finding = advisories.get(key) ?? {
        ...cause,
        status: blocking.has(key)
          ? "blocking"
          : mitigated.has(key)
            ? "mitigated"
            : ["high", "critical"].includes(cause.severity)
              ? "blocking"
              : "reported",
        packages: [],
        nodes: [],
      };
      finding.packages = [...new Set([...finding.packages, name])].sort();
      finding.nodes = [...new Set([...finding.nodes, ...value.nodes])].sort();
      advisories.set(key, finding);
    }
  }
  const declaredCounts = report.metadata?.vulnerabilities;
  if (
    !isRecord(declaredCounts) ||
    declaredCounts.total !== packages.length ||
    severities.some(
      (severity) =>
        !Number.isSafeInteger(declaredCounts[severity]) ||
        declaredCounts[severity] !== packageCounts[severity],
    )
  ) {
    throw new Error("npm audit lieferte unvollständige oder widersprüchliche Fundzahlen.");
  }
  return {
    ...evaluation,
    packageCounts,
    advisories: [...advisories.values()].sort(
      (a, b) =>
        severities.indexOf(b.severity) - severities.indexOf(a.severity) ||
        findingKey(a).localeCompare(findingKey(b)),
    ),
  };
}

function verifyInstalledHardening() {
  return [
    verifyNodeForgeHardening(),
    verifyBracesHardening(),
    verifyZodHardening(),
    decoderHardening.verifyDecodeUriComponentHardening(),
  ];
}

function writeReport(output, report) {
  if (!output) return;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function runDependencyAudit({
  args = process.argv.slice(2),
  execute = spawnSync,
  verify = verifyInstalledHardening,
  log = console.log,
  error = console.error,
} = {}) {
  let output;
  const checkedAt = new Date().toISOString();
  try {
    if (args.length !== 0) {
      if (
        args.length !== 2 ||
        args[0] !== "--output" ||
        !args[1]?.trim() ||
        args[1].startsWith("--")
      ) {
        throw new Error("Aufruf: npm run audit:all -- [--output <Datei>]");
      }
      output = resolve(args[1]);
    }
    const proofs = verify();
    const npmCliPath = process.env.npm_execpath;
    const result = execute(
      npmCliPath ? process.execPath : "npm",
      npmCliPath
        ? [npmCliPath, "audit", "--include=dev", "--json"]
        : ["audit", "--include=dev", "--json"],
      {
        encoding: "utf8",
        shell: !npmCliPath && process.platform === "win32",
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
      throw new Error("npm audit konnte nicht vollständig ausgeführt werden.");
    }
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw new Error("npm audit lieferte kein gültiges JSON.");
    }
    const evaluation = evaluateDependencyAuditReport(report, proofs);
    writeReport(output, {
      schemaVersion: 1,
      checkedAt,
      scope: "all-including-development",
      status: evaluation.blocking.length ? "blocked" : "passed",
      evaluation,
      npm: report,
    });
    for (const finding of evaluation.advisories) {
      log(
        `[${finding.status}/${finding.severity}] ${finding.name}: ${finding.title} (${finding.url})`,
      );
    }
    for (const finding of evaluation.blocking) {
      if (!evaluation.advisories.some((advisory) => findingKey(advisory) === findingKey(finding))) {
        error(`[blocking/${finding.severity}] ${finding.name}: ${finding.title}`);
      }
    }
    log(`Alle Abhängigkeiten einschließlich Dev: ${JSON.stringify(evaluation.packageCounts)}.`);
    log(
      `Verifizierte Backports: ${evaluation.mitigated.length}; unbehobene hohe/kritische Befunde: ${evaluation.blocking.length}.`,
    );
    log(
      "Weitere npm-Meldungen bleiben im Bericht sichtbar; moderate/low sind kein High-/Critical-Gate.",
    );
    return evaluation.blocking.length ? 1 : 0;
  } catch (failure) {
    error(failure instanceof Error ? failure.message : "Dependency-Audit fehlgeschlagen.");
    try {
      // Replace a prior success artifact on errors; never upload a stale green report.
      writeReport(output, {
        schemaVersion: 1,
        checkedAt,
        scope: "all-including-development",
        status: "error",
      });
    } catch {
      error("Der Audit-Fehlerbericht konnte nicht geschrieben werden.");
    }
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runDependencyAudit();
}
