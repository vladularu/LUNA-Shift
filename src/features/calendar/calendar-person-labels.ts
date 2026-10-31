export const CALENDAR_PERSON_WIDTH = 112;
export function calendarPersonLabels(
  rows: readonly { readonly id: string; readonly name: string }[],
): ReadonlyMap<string, string> {
  const names = rows.map((row) => {
    const parts = row.name.trim().split(/\s+/u).filter(Boolean);
    return {
      id: row.id,
      full: parts.join(" ") || "Kalender",
      first: parts[0] || "Kalender",
      last: parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "",
    };
  });
  const folded = (value: string) => value.toLocaleLowerCase("de-DE");
  const proposed = names.map((person) => ({
    ...person,
    label:
      names.filter((other) => folded(other.first) === folded(person.first)).length > 1 &&
      person.last
        ? `${person.first} ${person.last}.`
        : person.first,
  }));
  return new Map(
    proposed.map((person) => {
      if (person.id === "own") return [person.id, "Ich"];
      const same = proposed.filter((other) => folded(other.label) === folded(person.label));
      if (same.length < 2) return [person.id, person.label];
      const identical = same
        .filter((other) => folded(other.full) === folded(person.full))
        .map((other) => other.id)
        .sort();
      return [
        person.id,
        identical.length > 1 ? `${person.first} ${identical.indexOf(person.id) + 1}` : person.full,
      ];
    }),
  );
}
