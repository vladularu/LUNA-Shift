import { DutyChoice as ResponsiveDutyChoice } from "./special-duty-controls";

export function DutyChoice(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly onChange: (value: string) => void;
}) {
  return <ResponsiveDutyChoice {...props} stacked />;
}
