import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { GOOGLE_LOGO_COLORS, useOnboardingPalette } from "@/theme/onboarding";

export function SyncIllustration() {
  const p = useOnboardingPalette();
  return (
    <Svg accessible={false} width="100%" height={148} viewBox="0 0 230 136">
      <G fill="none" stroke={p.control} transform="rotate(-16 115 73)">
        <Ellipse cx={115} cy={73} rx={93} ry={36} />
        <Ellipse cx={115} cy={73} rx={72} ry={26} />
      </G>
      <Circle cx={36} cy={65} r={3} fill={p.syncOutline} />
      <Circle cx={192} cy={53} r={3.2} fill={p.highlight} />
      <G transform="rotate(-9 108 65)">
        <Path
          d="M77 90c-11 0-19-8-19-19 0-10 7-18 17-19 3-14 14-23 28-23 12 0 23 7 27 17 14-1 24 9 24 22s-10 22-23 22Z"
          fill={p.syncSurface}
          stroke={p.syncOutline}
          strokeWidth={2.5}
        />
        <Path
          d="M84 64c2-7 8-12 16-12 5 0 10 2 14 6m-1-8 2 9-10 1M112 70c-3 7-9 11-16 11-6 0-11-2-14-6m1 8-2-9 10-1"
          fill="none"
          stroke={p.syncAccent}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
      <G transform="rotate(9 145 84)" stroke={p.syncOutline}>
        <Rect x={131} y={63} width={32} height={49} rx={7} fill={p.surface} strokeWidth={2.2} />
        <Path d="M141 68h11m-10 38h9" strokeWidth={2} strokeLinecap="round" />
      </G>
    </Svg>
  );
}

export function GoogleMark() {
  return (
    <Svg accessible={false} width={24} height={24} viewBox="0 0 48 48">
      <Path
        fill={GOOGLE_LOGO_COLORS.red}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill={GOOGLE_LOGO_COLORS.blue}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill={GOOGLE_LOGO_COLORS.yellow}
        d="M10.53 28.59A14.4 14.4 0 0 1 9.78 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.76 23.76 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill={GOOGLE_LOGO_COLORS.green}
        d="M24 48c6.48 0 11.93-2.13 15.91-5.81l-7.73-6c-2.15 1.45-4.92 2.31-8.18 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}
