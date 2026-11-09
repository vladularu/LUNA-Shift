import type { ComplianceIssue } from "@/domain/types";
import { validComplianceIssueFacts } from "@/domain/compliance-issue-facts";
import { restDuration } from "./compliance-timeline";

export interface LegalCheckSource {
  readonly title: string;
  readonly url: string;
}

const arbzg3 = {
  title: "Arbeitszeitgesetz · § 3 Arbeitszeit",
  url: "https://www.gesetze-im-internet.de/arbzg/__3.html",
};
const arbzg4 = {
  title: "Arbeitszeitgesetz · § 4 Ruhepausen",
  url: "https://www.gesetze-im-internet.de/arbzg/__4.html",
};
const arbzg5 = {
  title: "Arbeitszeitgesetz · § 5 Ruhezeit",
  url: "https://www.gesetze-im-internet.de/arbzg/__5.html",
};
const arbzg6 = {
  title: "Arbeitszeitgesetz · § 6 Nacht- und Schichtarbeit",
  url: "https://www.gesetze-im-internet.de/arbzg/__6.html",
};
const arbzg10 = {
  title: "Arbeitszeitgesetz · § 10 Sonn- und Feiertagsbeschäftigung",
  url: "https://www.gesetze-im-internet.de/arbzg/__10.html",
};
const arbzg11 = {
  title: "Arbeitszeitgesetz · § 11 Ausgleich",
  url: "https://www.gesetze-im-internet.de/arbzg/__11.html",
};
const youth = {
  title: "Jugendarbeitsschutzgesetz",
  url: "https://www.gesetze-im-internet.de/jarbschg/BJNR009650976.html",
};
const bbig = {
  title: "Berufsbildungsgesetz · § 15 Freistellung und Anrechnung",
  url: "https://www.gesetze-im-internet.de/bbig_2005/__15.html",
};
const pflbg = {
  title: "Pflegeberufegesetz · § 18 Pflichten des Ausbildungsträgers",
  url: "https://www.gesetze-im-internet.de/pflbg/__18.html",
};

// Only known engine identifiers get fixed links. User/cached text never constructs a URL.
const sourceRules: Readonly<Record<string, readonly LegalCheckSource[]>> = {
  ARBZG_3_MAX_10H: [arbzg3],
  ARBZG_3_OVER_8H: [arbzg3],
  ARBZG_4_BREAK: [arbzg4],
  ARBZG_4_CONTINUOUS: [arbzg4],
  ARBZG_4_INTERRUPTION: [arbzg4],
  ARBZG_5_REST_10H: [arbzg5],
  ARBZG_5_REST_11H: [arbzg5],
  ARBZG_6_NIGHT_AVERAGE: [arbzg6],
  ARBZG_10_ELIGIBILITY: [arbzg10],
  ARBZG_11_SUNDAY_REST: [arbzg11],
  ARBZG_11_HOLIDAY_REST: [arbzg11],
  ARBZG_11_REST_CONNECTION: [arbzg11, arbzg5],
  ARBZG_11_FREE_SUNDAYS: [arbzg11],
  JARBSCHG_8_DAILY: [youth],
  JARBSCHG_8_WEEK: [youth],
  JARBSCHG_11_BREAK_DURATION: [youth],
  JARBSCHG_11_BREAK_PLACEMENT: [youth],
  JARBSCHG_12_SPAN: [youth],
  JARBSCHG_13_REST: [youth],
  JARBSCHG_14_NIGHT: [youth],
  JARBSCHG_15_FIVE_DAYS: [youth],
  JARBSCHG_16_17_WEEKEND: [youth],
  JARBSCHG_17_FREE_SUNDAYS: [youth],
  JARBSCHG_18_PROTECTED: [youth],
  JARBSCHG_18_HOLIDAY: [youth],
  JArbSchG: [youth],
  "§ 15 BBiG": [bbig],
  "§§ 18, 63 PflBG": [pflbg],
};

const youthSections = new Set([
  "§ 2 JArbSchG",
  "§ 4 JArbSchG",
  "§ 4 Abs. 4 JArbSchG",
  "§ 4 Abs. 5 JArbSchG",
  "§§ 2, 5–7 JArbSchG",
  "§§ 2, 4, 8 JArbSchG",
  "§§ 4, 11 JArbSchG",
  "§§ 8–10 JArbSchG",
  "§§ 8, 9 JArbSchG",
  "§§ 4, 8, 9 JArbSchG",
  "§§ 8, 14, 21–21b JArbSchG",
  "§§ 9, 11, 13 JArbSchG",
  "§§ 10, 11, 13 JArbSchG",
  "§ 9 JArbSchG",
  "§ 9 Abs. 1 Nr. 1 JArbSchG",
  "§ 10 JArbSchG",
  "§ 10 Abs. 1 Nr. 2 JArbSchG",
  "§ 10 Abs. 2 Nr. 2 JArbSchG",
  "§ 11 JArbSchG",
  "§ 11 Abs. 1 JArbSchG",
  "§ 11 Abs. 2 JArbSchG",
  "§ 12 JArbSchG",
  "§ 13 JArbSchG",
  "§ 14 JArbSchG",
  "§ 15 JArbSchG",
  "§ 16 JArbSchG",
  "§ 16 Abs. 2 JArbSchG",
  "§ 16 Abs. 3 JArbSchG",
  "§ 17 JArbSchG",
  "§ 17 Abs. 2 JArbSchG",
  "§ 17 Abs. 3 JArbSchG",
  "§ 18 JArbSchG",
  "§ 18 Abs. 1 JArbSchG",
  "§ 18 Abs. 2 JArbSchG",
  "§ 18 Abs. 3 JArbSchG",
  "§§ 10, 15 JArbSchG",
  "§§ 10, 16–18 JArbSchG",
]);

export function legalCheckPresentation(issue: ComplianceIssue) {
  const facts = validComplianceIssueFacts(issue.facts, issue.rule);
  let summary = "Einordnung in den Details prüfen.";
  if (facts?.rule === "ARBZG_3_MAX_10H")
    summary = `Erfasst: ${restDuration(facts.netMinutes)} netto · Prüfmaßstab: ${restDuration(facts.maximumMinutes)}.`;
  else if (facts?.rule === "ARBZG_3_OVER_8H")
    summary = `Erfasst: ${restDuration(facts.netMinutes)} netto. Ausgleich prüfen.`;
  else if (facts?.rule === "ARBZG_4_BREAK")
    summary = `Erfasst: ${facts.recordedBreakMinutes} Min. Pause · Prüfmaßstab: ${facts.requiredBreakMinutes} Min.`;
  else if (facts?.rule === "ARBZG_4_INTERRUPTION")
    summary = `${facts.interruptionMinutes} Min. Unterbrechung. Tatsächliche Pausenlage prüfen.`;
  else if (facts?.rule === "ARBZG_4_CONTINUOUS")
    summary = `Prüfmaßstab: höchstens ${restDuration(facts.maximumContinuousMinutes)} ohne Pause.`;
  else if (facts?.rule === "ARBZG_5_REST_10H" || facts?.rule === "JARBSCHG_13_REST")
    summary = `Erfasst: ${restDuration(facts.restMinutes)} Ruhezeit · Prüfmaßstab: ${restDuration(facts.minimumRestMinutes)}.`;
  else if (facts?.rule === "ARBZG_5_REST_11H")
    summary = `Erfasst: ${restDuration(facts.restMinutes)} Ruhezeit. Ausgleich prüfen.`;
  else if (facts?.rule === "TIME_PLAUSIBILITY")
    summary = `${facts.breakMinutes} Min. Pause bei ${facts.grossMinutes} Min. Dienstspanne. Zeitangaben prüfen.`;
  else if (["DATA_DUPLICATE", "SHIFT_OVERLAP"].includes(issue.rule))
    summary = "Zeitangaben prüfen.";
  const sources = Object.hasOwn(sourceRules, issue.rule)
    ? sourceRules[issue.rule]
    : youthSections.has(issue.rule)
      ? [youth]
      : [];
  return { summary, sources };
}
