/** Stable stored IDs. KZVK continues to mean the existing Cologne model. */
export const NET_PAY_PENSION_OPTIONS = [
  { value: "UNKNOWN", label: "Weiß ich nicht" },
  { value: "NONE", label: "Keine" },
  { value: "VBL_WEST", label: "VBL West" },
  { value: "VBL_EAST", label: "VBL Ost" },
  { value: "KZVK", label: "KZVK Köln" },
  { value: "KZVK_DORTMUND", label: "KZVK Dortmund · BAT-KF" },
  { value: "EZVK_DARMSTADT", label: "EZVK · Bestand Darmstadt" },
  { value: "EZVK_KARLSRUHE", label: "EZVK · Bestand Karlsruhe" },
  { value: "BVK_I", label: "BVK Bayern · Abrechnungsverband I" },
  { value: "BVK_II", label: "BVK Bayern · Abrechnungsverband II" },
  { value: "KVBW_I", label: "KVBW Baden-Württemberg · Verband I" },
  { value: "KVBW_II", label: "KVBW Baden-Württemberg · Verband II" },
  { value: "RZVK", label: "Rheinische ZVK · Verband I" },
  { value: "KVW_I", label: "kvw Westfalen-Lippe · Verband I" },
  { value: "KVW_II", label: "kvw Westfalen-Lippe · Verband II" },
  { value: "KVK_I", label: "KVK Kurhessen-Waldeck · Verband I" },
  { value: "ZVK_DARMSTADT_I", label: "ZVK Darmstadt · Verband I" },
  { value: "ZVK_DARMSTADT_II", label: "ZVK Darmstadt · Verband II" },
  { value: "KVBBG", label: "ZVK Brandenburg · ATV-K" },
  { value: "ZVK_SACHSEN", label: "ZVK Sachsen · ATV-K" },
  { value: "ZVK_THUERINGEN", label: "ZVK Thüringen · ATV-K" },
  { value: "OTHER", label: "Andere Kasse" },
] as const;

export type NetPayPensionScheme = (typeof NET_PAY_PENSION_OPTIONS)[number]["value"];
export type KnownNetPayPensionScheme = Exclude<NetPayPensionScheme, "NONE" | "UNKNOWN" | "OTHER">;

export const NET_PAY_PENSION_LABELS = Object.freeze({
  ...Object.fromEntries(NET_PAY_PENSION_OPTIONS.map(({ value, label }) => [value, label])),
  UNKNOWN: "Zusatzversorgung nicht berücksichtigt",
  OTHER: "Andere Kasse · offen",
}) as Readonly<Record<NetPayPensionScheme, string>>;

export function isNetPayPensionScheme(value: unknown): value is NetPayPensionScheme {
  return NET_PAY_PENSION_OPTIONS.some((option) => option.value === value);
}

/** EZVK's regular capital contribution is shared according to the employment agreement. */
export function netPayPensionMaxOwnRate(scheme: NetPayPensionScheme): number | null {
  return scheme === "EZVK_DARMSTADT" ? 330 : scheme === "EZVK_KARLSRUHE" ? 350 : null;
}
