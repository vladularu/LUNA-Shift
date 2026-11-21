import type { QuestionId, WorkplaceRule } from "@/domain/workplace-rules";
export interface Topic {
  title: string;
  question: string;
  basis: string;
  sample: string;
  example: Record<string, string>;
  choices: Record<string, string>;
}
export const topics: Record<QuestionId, Topic> = {
  week: {
    title: "Arbeitstage pro Woche",
    question: "Gibt es bei euch eine Obergrenze für Arbeitstage pro Woche?",
    basis:
      "§ 6 TVöD-AT regelt, wie die regelmäßige Arbeitszeit verteilt wird. Die Frage hier bezieht sich auf eine konkrete Grenze in deinem Dienstplan. Wenn du nur weißt, dass du eine 5-Tage-Woche hast, wähle „Weiß ich nicht“. LUNA zählt jeden Tag mit Dienstbeginn einmal.",
    sample:
      "Bei euch gelten über vier Wochen im Schnitt höchstens fünf Arbeitstage pro Woche. Sechs Tage in einer Woche und vier Tage in der nächsten können sich ausgleichen.",
    example: { mode: "average", count: "5", weeks: "4" },
    choices: {
      limit: "Feste Höchstzahl für jede Woche",
      average: "Höchstzahl im Schnitt mehrerer Wochen",
    },
  },
  series: {
    title: "Arbeitstage am Stück",
    question: "Wie viele Tage hintereinander darfst du laut Dienstplan arbeiten?",
    basis:
      "Für diese betriebliche Planungsfrage ergibt sich aus dem TVöD keine allgemeine feste Anzahl. LUNA zählt Dienstbeginne über Wochen- und Monatsgrenzen hinweg.",
    sample:
      "Nach sieben Arbeitstagen in Folge ist mindestens ein Tag frei. Die Folge zählt auch über den Sonntag hinaus.",
    example: { mode: "limit", count: "7" },
    choices: { limit: "Es gibt eine feste Obergrenze" },
  },
  weekend: {
    title: "Freie Wochenenden",
    question: "Wie oft hast du ein ganzes Wochenende frei?",
    basis:
      "§ 49 Abs. 3 BT-K und BT-B sieht für regelmäßig an Sonn- und Feiertagen Beschäftigte zwei freie Tage innerhalb von zwei Wochen vor. Einer soll ein Sonntag sein. Für ein ganzes freies Wochenende müssen Samstag und Sonntag frei sein. Der Sonntag bestimmt den Kalendermonat.",
    sample:
      "Ein Wochenende mit Dienst, das nächste frei. Endet dein Nachtdienst am Samstagmorgen, zählt dieses Wochenende als gearbeitet.",
    example: { mode: "alternate", anchor: "" },
    choices: {
      alternate: "Jedes zweite Wochenende",
      monthly: "Mindestens eine bestimmte Anzahl im Monat",
      rolling: "Eine feste Anzahl innerhalb mehrerer Wochen",
      off: "Alle Wochenenden sind frei",
    },
  },
  night: {
    title: "Nachtdienste am Stück",
    question: "Wie viele Nachtdienste darfst du hintereinander arbeiten?",
    basis:
      "Die BAuA empfiehlt höchstens drei Nachtdienste hintereinander. Das ist eine Empfehlung zur Schichtgestaltung. Eine feste betriebliche Grenze kannst du hier hinterlegen.",
    sample: "Bei uns werden höchstens vier Nachtdienste hintereinander geplant.",
    example: { mode: "limit", count: "4" },
    choices: { limit: "Es gibt eine feste Obergrenze", off: "Ich arbeite keine Nachtdienste" },
  },
  recovery: {
    title: "Erholung nach Nachtblöcken",
    question: "Wie viel freie Zeit ist nach mehreren Nachtdiensten vorgesehen?",
    basis:
      "Für diese Planungsregel gibt es keinen einheitlichen TVöD-Zahlenwert. Stunden zählen ab Dienstende. Endet ein Dienst am Montagmorgen, ist Dienstag der erste mögliche volle freie Kalendertag.",
    sample:
      "Nach drei oder mehr Nächten sind zwei ganze Tage frei. Endet die letzte Nacht am Montagmorgen, bleiben Dienstag und Mittwoch frei.",
    example: { mode: "recovery", nights: "3", count: "2", unit: "days" },
    choices: { recovery: "Erholungszeit eintragen" },
  },
  rest: {
    title: "Ruhezeit zwischen Diensten",
    question: "Welche Ruhezeit gilt zwischen deinen Diensten?",
    basis:
      "§ 5 ArbZG sieht grundsätzlich elf Stunden Ruhezeit vor. In Pflegeeinrichtungen ist eine Verkürzung um bis zu eine Stunde möglich, wenn jede Verkürzung innerhalb eines Kalendermonats oder von vier Wochen mit einer anderen Ruhezeit von mindestens zwölf Stunden ausgeglichen wird.",
    sample:
      "Der Spätdienst endet um 21 Uhr, der Frühdienst beginnt um 7 Uhr. Das sind zehn Stunden Ruhezeit. Zum Ausgleich dauert eine andere Ruhezeit innerhalb von vier Wochen mindestens zwölf Stunden.",
    example: {
      mode: "short",
      hours: "10",
      duty: "regular",
      basis: "§ 5 Abs. 2 ArbZG",
      compensation: "Mindestens 12 Stunden innerhalb von 4 Wochen",
    },
    choices: {
      standard: "Gesetzliche Regel · mindestens 11 Stunden",
      short: "Krankenhaus oder Pflegeeinrichtung · verkürzt auf 10 Stunden mit Ausgleich",
      rest: "Bei uns gilt eine andere Ruhezeit",
    },
  },
  switch: {
    title: "Unerwünschte Dienstwechsel",
    question: "Welche Dienstwechsel soll die Planung vermeiden?",
    basis:
      "Diese Planungsregel kann auch dann greifen, wenn die gesetzliche Ruhezeit eingehalten ist.",
    sample: "Kein Spätdienst direkt vor einem Frühdienst.",
    example: { mode: "switch", from: "LATE", to: "EARLY" },
    choices: { switch: "Einen bestimmten Wechsel vermeiden" },
  },
  duration: {
    title: "Höchstarbeitszeit",
    question: "Gilt für bestimmte Dienste eine eigene Höchstdauer?",
    basis:
      "§ 3 ArbZG sieht acht Stunden werktäglich vor, bei Ausgleich bis zu zehn. Abweichungen nach § 7 hängen von ihrer Grundlage und den Voraussetzungen des Dienstes ab. Eine eingegebene Dauer allein bestätigt ihre Zulässigkeit nicht.",
    sample:
      "Ein Bereitschaftsdienst dauert laut Dienstplan höchstens zwölf Stunden, von 7 bis 19 Uhr. Die Pausen sind darin enthalten.",
    example: { mode: "duration", hours: "12", duty: "standby", gross: "yes" },
    choices: { duration: "Ja, für bestimmte Dienste" },
  },
};
export type Draft = Record<string, string>;
export function draftFor(rule?: WorkplaceRule): Draft {
  if (!rule) return { mode: "" };
  const draft: Draft = Object.fromEntries(
    Object.entries(rule).map(([key, value]) => [key, String(value ?? "")]),
  );
  if (rule.mode === "rest" && rule.makeup) {
    draft.makeupKnown = "yes";
    draft.makeupHours = String(rule.makeup.minutes / 60);
    draft.makeupDays = String(rule.makeup.days);
  }
  if ("minutes" in rule) draft.hours = String(rule.minutes / 60);
  if (
    rule.mode === "rest" &&
    rule.duty === "all" &&
    rule.minutes === 660 &&
    !rule.agreementConfirmed &&
    !rule.basis &&
    !rule.compensation
  )
    draft.mode = "standard";
  if (
    rule.mode === "rest" &&
    rule.minutes === 600 &&
    rule.duty === "regular" &&
    !rule.agreementConfirmed &&
    !rule.makeup &&
    ((!rule.basis && !rule.compensation) ||
      (rule.basis === topics.rest.example.basis &&
        rule.compensation === topics.rest.example.compensation))
  )
    draft.mode = "short";
  if ("gross" in rule) draft.gross = rule.gross ? "yes" : "no";
  return draft;
}
export function isAgreedShortRestDraft(d: Draft) {
  const hours = Number(d.hours?.replace(",", "."));
  return d.mode === "rest" && d.source === "agreed" && hours >= 9 && hours < 11;
}
export function ruleInput(d: Draft): unknown {
  const mode = d.mode === "standard" || d.mode === "short" ? "rest" : d.mode;
  const value = (key: string) => Number((d[key] ?? "").replace(",", "."));
  return {
    ...d,
    mode,
    count: value("count"),
    weeks: value("weeks"),
    minutes:
      d.mode === "standard" ? 660 : d.mode === "short" ? 600 : Math.round(value("hours") * 60),
    nights: value("nights"),
    onRequest: d.onRequest === "true",
    gross: d.gross === "yes",
    anchor: d.anchor?.trim() || null,
    basis: d.basis ?? "",
    compensation: d.compensation ?? "",
    agreementConfirmed: isAgreedShortRestDraft(d) ? true : undefined,
    makeup:
      isAgreedShortRestDraft(d) && d.makeupKnown === "yes"
        ? { minutes: Math.round(value("makeupHours") * 60), days: value("makeupDays") }
        : undefined,
    duty: d.mode === "standard" ? "all" : d.mode === "short" ? "regular" : d.duty,
  };
}
