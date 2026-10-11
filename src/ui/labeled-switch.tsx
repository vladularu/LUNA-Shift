import type { SwitchProps } from "react-native";
import { Switch } from "@/ui/switch";

export function LabeledSwitch({ label, ...props }: SwitchProps & { readonly label: string }) {
  return <Switch accessibilityLabel={label} {...props} />;
}
