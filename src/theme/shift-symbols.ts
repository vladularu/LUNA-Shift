import type { ShiftType } from "@/domain/types";

export const SHIFT_SYMBOLS = [
  {
    id: "coff",
    label: "Pause",
    path: "M4 6h13v1h2a3.5 3.5 0 0 1 0 7h-2.6a6 6 0 0 1-5.4 3.5H10a6 6 0 0 1-6-6V6Zm13 3v2.5l-.02.5H19a1.5 1.5 0 0 0 0-3h-2ZM3 19h18v2H3z",
  },
  {
    id: "rise",
    label: "Sonnenaufgang",
    path: "M7 14a5 5 0 0 1 10 0H7ZM11 3h2v4h-2zM4 7.4 5.4 6l2.8 2.8-1.4 1.4zM15.8 8.8 18.6 6 20 7.4l-2.8 2.8zM2 12.5h3v1.75H2zM19 12.5h3v1.75h-3zM3 16.5h18v2H3zM6 20h12v1.5H6z",
  },
  {
    id: "sun",
    label: "Sonne",
    path: "M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM11 2h2v3h-2zM11 19h2v3h-2zM2 11h3v2H2zM19 11h3v2h-3zM4.2 5.6l1.4-1.4 2.2 2.2-1.4 1.4zM16.2 6.4l2.2-2.2 1.4 1.4-2.2 2.2zM4.2 18.4l2.2-2.2 1.4 1.4-2.2 2.2zM16.2 17.6l1.4-1.4 2.2 2.2-1.4 1.4z",
  },
  { id: "moon", label: "Mond", path: "M13.4 2.8a8 8 0 0 0 7.8 12.5A9.5 9.5 0 1 1 13.4 2.8Z" },
  { id: "home", label: "Zuhause", path: "M2.5 11.4 12 3l9.5 8.4H19v9.1h-5v-6h-4v6H5v-9.1Z" },
  {
    id: "call",
    label: "Telefon",
    path: "M6.2 3h2.6c.7 0 1.1.4 1.2 1l.6 3.4c.1.5-.1.9-.5 1.2l-2 1.5a13 13 0 0 0 5.8 5.8l1.5-2c.3-.4.7-.6 1.2-.5l3.4.6c.6.1 1 .5 1 1.2v2.6a2.5 2.5 0 0 1-2.8 2.5A18 18 0 0 1 3.7 5.8 2.5 2.5 0 0 1 6.2 3Z",
  },
  {
    id: "case",
    label: "Koffer",
    path: "M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6h3a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 18V8.5A2.5 2.5 0 0 1 5 6h3Zm2 0h4V5h-4v1Zm-3.8 2h1.5v10.5H6.2zM16.3 8h1.5v10.5h-1.5z",
  },
  {
    id: "book",
    label: "Buch",
    path: "M2.2 5.4c3.1-1.8 6.1-1.8 8.8.4v14.3c-2.7-2.1-5.7-2.2-8.8-.4V5.4ZM13 5.8c2.7-2.2 5.7-2.2 8.8-.4v14.3c-3.1-1.8-6.1-1.7-8.8.4V5.8Z",
  },
  {
    id: "list",
    label: "Aufgaben",
    path: "M8 5a2.5 2.5 0 0 1 2.5-2.5h3A2.5 2.5 0 0 1 16 5h1.5A2.5 2.5 0 0 1 20 7.5v11A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8Zm2 .1v1.4h4V5.1h-4Zm.8 10.2L8.4 13l-1.3 1.4 3.7 3.6 5.8-6-1.4-1.3-4.4 4.6Z",
  },
  {
    id: "team",
    label: "Team",
    path: "M10.5 7.2a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0Zm9.4 0a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0ZM2 18a5.3 5.3 0 0 1 10.6 0v2H2v-2Zm12 2v-2c0-1.5-.5-3-1.2-4a5.3 5.3 0 0 1 9.2 4v2h-8Z",
  },
  {
    id: "time",
    label: "Uhr",
    path: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM11 6v6.7l4.9 3 1-1.7-3.9-2.4V6h-2Z",
  },
  {
    id: "med",
    label: "Arztkoffer",
    path: "M8.5 6V4.8A1.8 1.8 0 0 1 10.3 3h3.4a1.8 1.8 0 0 1 1.8 1.8V6h2.8A3.2 3.2 0 0 1 21.5 9.2v8.6a3.2 3.2 0 0 1-3.2 3.2H5.7a3.2 3.2 0 0 1-3.2-3.2V9.2A3.2 3.2 0 0 1 5.7 6h2.8Zm1.8 0h3.4V5h-3.4v1Zm.3 3.7v2.7H8v2.8h2.6V18h2.8v-2.8H16v-2.8h-2.6V9.7h-2.8Z",
  },
  {
    id: "ambu",
    label: "Rettungswagen",
    path: "M2 7.5A1.5 1.5 0 0 1 3.5 6H15v3h3.2l3.8 4.3V18h-2.1a3.3 3.3 0 0 0-6.3 0H9.5a3.3 3.3 0 0 0-6.3 0H2V7.5Zm5.1.8v2H5.2v1.8h1.9v2h1.8v-2h2v-1.8h-2v-2H7.1ZM15 11v2.7h4.6L17.4 11H15ZM8.4 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10.3 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  },
  {
    id: "cash",
    label: "Geld",
    path: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-5-4.1a5 5 0 0 0-8.6 2.4H7v1.2h1.1v1H7v1.2h1.4a5 5 0 0 0 8.6 2.4l-1-1.2a3.5 3.5 0 0 1-5.7-1.2h3.8l.4-1.2H10v-1h4.8l.4-1.2h-4.9A3.5 3.5 0 0 1 16 9l1-1.1Z",
  },
  {
    id: "palm",
    label: "Urlaub",
    path: "M8.9 21c.5-4.3 1.4-7.9 3.3-11.7-2.2.8-4 2.5-5.4 4.9-.6-3.1.7-5.6 3.4-7.2-2.8-.4-5.6.7-7.7 2.8.8-4.9 4.8-6.1 8.6-4.5C10.1 3.9 8.5 3 7 2.7c3.1-.9 5.9.2 7.1 2.6 3.2-2.1 6.5-1 8 2.8-2.3-1.4-4.7-1.8-6.5-.8 2.9 1 4.3 3.6 4 6.5-1.4-2.4-3-3.9-5-4.6C13 12.7 12.2 17 12 21H8.9Z",
  },
  {
    id: "hosp",
    label: "Krankenhaus",
    path: "M6 3h12v7h3v11h-7v-5h-4v5H3V10h3V3Zm5 2v2H9v2h2v2h2V9h2V7h-2V5h-2ZM5 12v2.4h2V12H5Zm12 0v2.4h2V12h-2Z",
  },
  {
    id: "tool",
    label: "Werkzeug",
    path: "M21 3.4a5.4 5.4 0 0 1-6.3 7.5L6.2 20a2.1 2.1 0 0 1-3-2.9l8.6-8.6a5.4 5.4 0 0 1 6.9-6.2L15.6 5l.2 2.3 2.3.2L21 3.4Z",
  },
  {
    id: "star",
    label: "Stern",
    path: "m12 2.5 2.9 5.9 6.6 1-4.8 4.7 1.1 6.6-5.8-3.1-5.8 3.1 1.1-6.6-4.8-4.7 6.6-1L12 2.5Z",
  },
  {
    id: "smil",
    label: "Smiley",
    path: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM10 9.3a1.3 1.3 0 1 0-2.6 0 1.3 1.3 0 0 0 2.6 0Zm6.6 0a1.3 1.3 0 1 0-2.6 0 1.3 1.3 0 0 0 2.6 0ZM7 13a5.1 5.1 0 0 0 10 0H7Z",
  },
] as const;

export type ShiftSymbolId = (typeof SHIFT_SYMBOLS)[number]["id"];

const SYMBOLS_BY_ID = new Map(SHIFT_SYMBOLS.map((symbol) => [symbol.id, symbol]));

export const DEFAULT_SHIFT_SYMBOLS: Readonly<Record<ShiftType, ShiftSymbolId>> = {
  EARLY: "rise",
  LATE: "sun",
  NIGHT: "moon",
  DAY: "home",
  TRAINING: "book",
  VACATION: "palm",
  SICK: "med",
  FREE: "star",
  CUSTOM: "time",
};

export function shiftSymbolDefinition(value: string) {
  return SYMBOLS_BY_ID.get(value as ShiftSymbolId) ?? null;
}

export function isShiftSymbolId(value: string): value is ShiftSymbolId {
  return SYMBOLS_BY_ID.has(value as ShiftSymbolId);
}
