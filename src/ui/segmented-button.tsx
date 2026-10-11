import { SelectionChip } from "@/ui/selection-option";
export function SegmentedButton({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return <SelectionChip label={label} selected={selected} onPress={onPress} style={{ flex: 1 }} />;
}
