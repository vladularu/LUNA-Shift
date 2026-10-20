import { formatMonthTitle } from "@/engine/calendar";
import { NetPayWorkflowSelect, NetPayWorkflowText } from "./net-pay-workflow-controls";

export function NetPayValidity({
  month,
  firstSetup,
  value,
  onChange,
  disabled,
}: {
  readonly month: string;
  readonly firstSetup: boolean;
  readonly value: string;
  readonly onChange: (month: string) => void;
  readonly disabled: boolean;
}) {
  const year = month.slice(0, 4);
  if (firstSetup) return <NetPayWorkflowText>Für das ganze Jahr {year}</NetPayWorkflowText>;
  const options = Array.from({ length: 12 }, (_, index) => {
    const value = year + "-" + String(index + 1).padStart(2, "0");
    return { value, label: formatMonthTitle(value) };
  });
  return (
    <NetPayWorkflowSelect
      label="Gültig ab"
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
