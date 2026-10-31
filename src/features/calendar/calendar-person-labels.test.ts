import { expect, it } from "vitest";
import { calendarPersonLabels } from "./calendar-person-labels";
it("keeps familiar first names beside avatars and uses Ich for the own account", () => {
  expect([
    ...calendarPersonLabels([
      { id: "own", name: "Ich" },
      { id: "s", name: " Selena  Müller " },
      { id: "l", name: "Laura Trost" },
    ]).values(),
  ]).toEqual(["Ich", "Selena", "Laura"]);
});
it("distinguishes matching first names with surname initials", () => {
  expect([
    ...calendarPersonLabels([
      { id: "a", name: "Alex Müller" },
      { id: "b", name: "Alex Sommer" },
    ]).values(),
  ]).toEqual(["Alex M.", "Alex S."]);
});
it("uses full names when the surname initial would still be ambiguous", () => {
  expect([
    ...calendarPersonLabels([
      { id: "a", name: "Alex Sommer" },
      { id: "b", name: "Alex Schwarz" },
    ]).values(),
  ]).toEqual(["Alex Sommer", "Alex Schwarz"]);
});
it("keeps identical-name disambiguation stable when calendars are reordered", () => {
  const rows = [
    { id: "b", name: "Alex" },
    { id: "a", name: "Alex" },
  ];
  expect(calendarPersonLabels(rows).get("a")).toBe("Alex 1");
  expect(calendarPersonLabels([...rows].reverse()).get("a")).toBe("Alex 1");
});
it("handles Unicode names and an empty older calendar label", () => {
  expect([
    ...calendarPersonLabels([
      { id: "e", name: " élodie Grün " },
      { id: "empty", name: " " },
    ]).values(),
  ]).toEqual(["élodie", "Kalender"]);
});
