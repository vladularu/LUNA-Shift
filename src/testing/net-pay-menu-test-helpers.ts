import { fireEvent, type render, within } from "@testing-library/react-native";

export async function selectNativeNetPayOption(
  screen: Awaited<ReturnType<typeof render>>,
  field: string,
  label: string,
) {
  const picker = screen.queryByTestId(`net-pay-native-options:${field}`);
  if (!picker) return false;
  const option = within(picker).getByTestId(`net-pay-native-option:${label}`);
  const [{ tag }] = option.props.modifiers;
  await fireEvent(picker, "selectionChange", { nativeEvent: { selection: tag } });
  return true;
}
