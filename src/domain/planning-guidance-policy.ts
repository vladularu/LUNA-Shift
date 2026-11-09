/** Product guidance has its own sources and never rewrites statutory catalog packages. */
export const PLANNING_GUIDANCE_POLICY = {
  version: "2026-11-08",
  maximumWorkSeries: 5,
  firstWorkSeriesHint: 6,
  workSeriesSource: {
    title: "BAuA: Handbuch Gefährdungsbeurteilung",
    url: "https://www.baua.de/DE/Themen/Arbeitsgestaltung/Gefaehrdungsbeurteilung/Handbuch-Gefaehrdungsbeurteilung/Expertenwissen/Arbeitszeitgestaltung/Arbeitszeitgestaltung?view=pdfViewExt",
    section: "Kapitel 10.2.5, Prüfliste Schichtarbeit",
    version: "Hrsg. 2023, abgerufen 08.11.2026",
  },
} as const;
