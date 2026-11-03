import Svg, { Path } from "react-native-svg";

export function OnboardingCheck({
  color,
  size = 14,
}: {
  readonly color: string;
  readonly size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" accessible={false}>
      <Path
        d="M2 6l3 3 5-6"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
