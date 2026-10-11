import { SelectionControl } from "@/ui/selection-control";

import type { AppearanceMode } from "@/domain/appearance";

import { selectionFeedback } from "@/ui/haptics";

const MODES = [
  { id: "light", label: "Hell", icon: "sunny-outline", selectedIcon: "sunny" },
  { id: "dark", label: "Dunkel", icon: "moon-outline", selectedIcon: "moon" },
  { id: "system", label: "System", icon: "phone-portrait-outline", selectedIcon: "phone-portrait" },
] as const;

export function AppearanceModeControl({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: AppearanceMode;
  readonly onChange: (mode: AppearanceMode) => void;
  readonly disabled?: boolean;
}) {
  return (
    <SelectionControl
      accessibilityLabel="Erscheinungsbild"
      value={value}
      disabled={disabled}
      items={MODES.map((mode) => ({
        value: mode.id,
        label: mode.label,
        icon: mode.icon,
        selectedIcon: mode.selectedIcon,
        accessibilityHint: mode.id === "system" ? "Folgt der Darstellung deines Geräts" : undefined,
      }))}
      onChange={(mode) => {
        if (mode === value) return;
        selectionFeedback();
        onChange(mode);
      }}
    />
  );
}
