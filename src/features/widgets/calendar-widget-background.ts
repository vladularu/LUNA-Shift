// Android/Web never load the iOS App Group or photo-processing modules.
export async function prepareCalendarWidgetBackground(_uri: string | null): Promise<string | null> {
  return null;
}
export function pruneCalendarWidgetBackgrounds(_keep: string | null): void {}
