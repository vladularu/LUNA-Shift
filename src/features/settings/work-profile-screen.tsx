import { SettingsEditorScreen } from "./settings-editor-screen";
/** Existing deep links share the same employment editor and save operation. */
export function WorkProfileScreen() {
  return <SettingsEditorScreen sectionOverride="EMPLOYMENT" />;
}
