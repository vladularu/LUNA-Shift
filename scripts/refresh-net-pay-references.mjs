/** Explicit developer action only. No app import; no real personal payroll data. */
import { writeFile } from "node:fs/promises";

const code = process.env.BMF_TEST_CODE;
if (!code)
  throw new Error("Set BMF_TEST_CODE after explicitly accepting the BMF test usage terms.");

const base = {
  birthDate: "1990-01-15",
  taxClass: 1,
  factorPermille: null,
  churchTaxRatePercent: 9,
  childAllowanceHalfUnits: 0,
  isParent: false,
  childrenUnder25: 0,
  worksInSaxony: false,
  healthAdditionalRateBps: 290,
  monthlyTaxAllowanceCents: 0,
};
const cases = [];
function add(name, grossCents, patch = {}, month = "2026-07") {
  const profile = { ...base, ...patch };
  const input = {
    month,
    profile,
    amounts: {
      grossCents,
      taxableGrossCents: grossCents,
      socialInsuranceGrossCents: grossCents,
      regularMonthlySocialInsuranceGrossCents: grossCents,
    },
    specialCases: [],
  };
  const birthYear = Number(profile.birthDate.slice(0, 4));
  const birthdayMonth = Number(profile.birthDate.slice(5, 7));
  const monthNumber = Number(month.slice(5, 7));
  const childless =
    !profile.isParent &&
    (2026 > birthYear + 23 || (2026 === birthYear + 23 && monthNumber > birthdayMonth));
  // Independent mapping kept in the recorded fixtures for review of the app adapter.
  const parameters = {
    LZZ: "2",
    RE4: String(grossCents),
    STKL: String(profile.taxClass),
    af: profile.factorPermille === null ? "0" : "1",
    f: profile.factorPermille === null ? "1" : (profile.factorPermille / 1000).toFixed(3),
    R: profile.churchTaxRatePercent === 0 ? "0" : "1",
    ZKF: (profile.childAllowanceHalfUnits / 2).toFixed(1),
    KVZ: (profile.healthAdditionalRateBps / 100).toFixed(2),
    PVS: profile.worksInSaxony ? "1" : "0",
    PVZ: childless ? "1" : "0",
    PVA: String(Math.max(0, Math.min(profile.childrenUnder25, 5) - 1)),
    PKV: "0",
    KRV: "0",
    ALV: "0",
    ALTER1: "0",
    LZZFREIB: String(profile.monthlyTaxAllowanceCents),
    LZZHINZU: "0",
    SONSTB: "0",
  };
  cases.push({ name, input, parameters });
}

for (const taxClass of [1, 2, 3, 4, 5, 6]) {
  add(`class-${taxClass}`, 500000, { taxClass, isParent: taxClass === 2 });
}
for (const gross of [200001, 300000, 400000, 581249, 581250, 581251, 845000, 845001, 1000000]) {
  add(`gross-${gross}`, gross);
}
add("no-church", 500000, { churchTaxRatePercent: 0 });
add("church-eight", 500000, { churchTaxRatePercent: 8 });
add("factor-800", 500000, { taxClass: 4, factorPermille: 800 });
add("factor-001", 500000, { taxClass: 4, factorPermille: 1 });
add("factor-999", 500000, { taxClass: 4, factorPermille: 999 });
add("half-child-allowance", 500000, { childAllowanceHalfUnits: 1 });
add("full-child-allowance", 1000000, { childAllowanceHalfUnits: 2, isParent: true });
for (const childrenUnder25 of [0, 1, 2, 3, 4, 5, 6]) {
  add(`parent-${childrenUnder25}`, 500000, { isParent: true, childrenUnder25 });
}
add("saxony-childless", 500000, { worksInSaxony: true });
add("saxony-two-children", 500000, { worksInSaxony: true, isParent: true, childrenUnder25: 2 });
add("tk-additional-rate", 500000, { healthAdditionalRateBps: 269 });
add("zero-additional-rate", 500000, { healthAdditionalRateBps: 0 });
add("monthly-tax-allowance", 500000, { monthlyTaxAllowanceCents: 10000 });
add("before-23", 500000, { birthDate: "2003-07-15" }, "2026-06");
add("birthday-month-23", 500000, { birthDate: "2003-07-15" }, "2026-07");
add("after-23", 500000, { birthDate: "2003-07-15" }, "2026-08");
add("birthday-first-day", 500000, { birthDate: "2003-07-01" }, "2026-07");

const endpoint = "https://www.bmf-steuerrechner.de/interface/2026Version1.xhtml";
for (const item of cases) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ code, ...item.parameters }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error(`BMF HTTP ${response.status} for ${item.name}`);
  const xml = await response.text();
  if (!xml.includes('<lohnsteuer jahr="2026">') || /status="(?!ok")/.test(xml)) {
    throw new Error(`Invalid BMF response for ${item.name}; inspect access/parameters.`);
  }
  const outputs = Object.fromEntries(
    [...xml.matchAll(/<ausgabe name="([A-Z0-9]+)" value="([0-9]+)"/g)].map((m) => [
      m[1],
      Number(m[2]),
    ]),
  );
  if (!["LSTLZZ", "SOLZLZZ", "BK"].every((name) => Number.isSafeInteger(outputs[name]))) {
    throw new Error(`Incomplete BMF response for ${item.name}`);
  }
  item.expected = {
    wageTaxCents: outputs.LSTLZZ,
    solidarityCents: outputs.SOLZLZZ,
    churchTaxBasisCents: outputs.BK,
  };
}
const destination = new URL("./fixtures/net-pay/bmf-2026-reference.json", import.meta.url);
await writeFile(
  destination,
  JSON.stringify(
    {
      source: endpoint,
      usage: "Synthetic program verification only; never used for app calculations.",
      capturedAt: new Date().toISOString(),
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Saved ${cases.length} synthetic BMF reference cases.`);
