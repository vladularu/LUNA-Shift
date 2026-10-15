import { memo, useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import {
  DINO_HEIGHT,
  DINO_WIDTH,
  DINO_X,
  RUNNER_GROUND,
  RUNNER_HEIGHT,
  RUNNER_WIDTH,
  runnerPoints,
  type RunnerObstacle,
} from "./dino-runner-engine";
import { useDinoRunner } from "./use-dino-runner";

// Original tiny pixel dinosaur; no remote images or website code.
const PIXELS = [
  "      XXXXXXX",
  "      XXXXX X",
  "      XXXXXXX",
  "      XXXX   ",
  "X    XXXXXX  ",
  "XX  XXXXX    ",
  "XXXXXXXXX X  ",
  " XXXXXXXX    ",
  "  XXXXXX     ",
  "   XX XX     ",
];
const Dino = memo(function Dino({ color, stride }: { color: string; stride: boolean }) {
  return (
    <View style={styles.sprite} accessibilityElementsHidden importantForAccessibility="no">
      {PIXELS.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "X" ? (
            <View
              key={y * 20 + x}
              style={{
                position: "absolute",
                left: x * 2.5,
                top: y * 3,
                width: 2.6,
                height: 3.1,
                backgroundColor: color,
              }}
            />
          ) : null,
        ),
      )}
      <View style={[styles.foot, { left: 8, height: stride ? 9 : 5, backgroundColor: color }]} />
      <View style={[styles.foot, { left: 19, height: stride ? 5 : 9, backgroundColor: color }]} />
    </View>
  );
});

export function DinoRunnerIcon({ color }: { readonly color: string }) {
  return (
    <View
      testID="dino-runner-idle"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: 104, height: 104, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ transform: [{ scale: 2.4 }] }}>
        <Dino color={color} stride={false} />
      </View>
    </View>
  );
}

const Obstacle = memo(function Obstacle({
  obstacle,
  color,
  flap,
}: {
  obstacle: RunnerObstacle;
  color: string;
  flap: boolean;
}) {
  const count = obstacle.count ?? 1;
  return (
    <View
      testID={`runner-obstacle-${obstacle.kind ?? "cactus"}`}
      style={[
        styles.obstacle,
        {
          left: obstacle.x,
          top: RUNNER_GROUND - obstacle.height - (obstacle.bottom ?? 0),
          width: obstacle.width,
          height: obstacle.height,
        },
      ]}
    >
      {obstacle.kind === "bird" ? (
        <>
          <View style={[styles.birdBody, { backgroundColor: color }]} />
          <View style={[styles.birdHead, { backgroundColor: color }]} />
          <View style={[styles.birdBeak, { backgroundColor: color }]} />
          <View
            style={[
              styles.birdWing,
              {
                top: flap ? 2 : 15,
                transform: [{ rotate: flap ? "-30deg" : "30deg" }],
                backgroundColor: color,
              },
            ]}
          />
        </>
      ) : (
        Array.from({ length: count }, (_, index) => (
          <View
            key={index}
            style={[
              styles.cactus,
              {
                left: (index * (obstacle.width + 6)) / count,
                width: (obstacle.width - 6 * (count - 1)) / count,
                height: obstacle.height,
              },
            ]}
          >
            <View style={[styles.cactusStem, { backgroundColor: color }]} />
            <View style={[styles.cactusArm, { left: 0, backgroundColor: color }]} />
            <View style={[styles.cactusArm, { right: 0, top: 9, backgroundColor: color }]} />
          </View>
        ))
      )}
    </View>
  );
});

export function DinoRunnerGame({ onClose }: { readonly onClose: () => void }) {
  const p = usePalette();
  const game = useDinoRunner();
  const { pause } = game;
  useFocusEffect(
    useCallback(
      () => () => {
        pause();
        onClose();
      },
      [pause, onClose],
    ),
  );
  const [scale, setScale] = useState(1);
  const points = runnerPoints(game.run);
  const best = Math.max(points, game.scores[0]?.points ?? 0);
  const label = game.error
    ? game.loaded
      ? "Erneut speichern"
      : "Erneut laden"
    : game.run.over
      ? "Nochmal spielen"
      : "Springen";

  function tap() {
    if (game.error) game.retry();
    if (!game.loaded) return;
    if (game.playing) game.jump();
    else game.start();
  }

  return (
    <View testID="dino-runner" style={styles.game}>
      <Pressable
        testID="runner-field"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Tippen springt oder startet einen neuen Lauf."
        accessibilityValue={{ text: `Punkte ${points}, Highscore ${best}` }}
        accessibilityState={{ disabled: !game.loaded && !game.error }}
        disabled={!game.loaded && !game.error}
        onPress={tap}
        onLayout={(event) => setScale(event.nativeEvent.layout.width / RUNNER_WIDTH)}
        style={styles.field}
      >
        {game.loaded ? (
          <View pointerEvents="none" style={{ width: "100%", gap: SPACING.sm }}>
            <View style={styles.scores}>
              <Text
                testID="runner-best"
                accessibilityLabel={`Highscore ${best}`}
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.score, { color: p.textMuted }]}
              >
                HI {String(best).padStart(5, "0")}
              </Text>
              <Text
                testID="runner-score"
                accessibilityLabel={`Punkte ${points}`}
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.score, { color: p.text }]}
              >
                {String(points).padStart(5, "0")}
              </Text>
            </View>
            <View style={{ height: RUNNER_HEIGHT * scale }}>
              <View
                style={[styles.world, { transform: [{ scale }] }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {[110, 290].map((offset, index) => (
                  <Text
                    key={offset}
                    style={[
                      styles.cloud,
                      {
                        color: p.textMuted,
                        left:
                          (offset + RUNNER_WIDTH - ((game.run.distance * 0.12) % RUNNER_WIDTH)) %
                          RUNNER_WIDTH,
                        top: index ? 40 : 25,
                      },
                    ]}
                  >
                    ☁
                  </Text>
                ))}
                <View style={[styles.ground, { backgroundColor: p.textMuted }]} />
                {Array.from({ length: 6 }, (_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.groundMark,
                      {
                        left:
                          (index * 80 + RUNNER_WIDTH - (game.run.distance % RUNNER_WIDTH)) %
                          RUNNER_WIDTH,
                        top: RUNNER_GROUND + 5 + (index % 3) * 3,
                        backgroundColor: p.textMuted,
                      },
                    ]}
                  />
                ))}
                <View style={[styles.dino, { transform: [{ translateY: -game.run.y }] }]}>
                  <Dino
                    color={p.text}
                    stride={
                      game.playing &&
                      game.run.y === 0 &&
                      Math.floor(game.run.distance / 18) % 2 === 0
                    }
                  />
                </View>
                {game.run.obstacles.map((obstacle, index) => (
                  <Obstacle
                    key={index}
                    obstacle={obstacle}
                    color={p.text}
                    flap={Math.floor(game.run.elapsed * 8) % 2 === 0}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : null}
        {game.error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: p.danger }]}>
            {game.error}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  game: { width: "100%", flexGrow: 1, minHeight: 280 },
  field: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
    justifyContent: "center",
    paddingBottom: 96,
  },
  scores: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: SPACING.md,
  },
  score: { ...TYPOGRAPHY.caption, fontVariant: ["tabular-nums"] },
  error: { position: "absolute", bottom: SPACING.md, ...TYPOGRAPHY.caption },
  world: {
    position: "absolute",
    top: 0,
    width: RUNNER_WIDTH,
    height: RUNNER_HEIGHT,
    transformOrigin: "top left",
  },
  ground: { position: "absolute", left: 0, right: 0, top: RUNNER_GROUND, height: 2 },
  groundMark: { position: "absolute", width: 9, height: 2, opacity: 0.45 },
  dino: {
    position: "absolute",
    left: DINO_X,
    top: RUNNER_GROUND - DINO_HEIGHT,
    width: DINO_WIDTH,
    height: DINO_HEIGHT,
  },
  sprite: { width: DINO_WIDTH, height: DINO_HEIGHT },
  foot: { position: "absolute", top: 30, width: 6 },
  cloud: { position: "absolute", top: 40, ...TYPOGRAPHY.sectionTitle, opacity: 0.35 },
  obstacle: { position: "absolute" },
  birdBody: { position: "absolute", left: 8, top: 10, width: 27, height: 7 },
  birdHead: { position: "absolute", left: 5, top: 6, width: 9, height: 10 },
  birdBeak: { position: "absolute", left: 0, top: 10, width: 9, height: 4 },
  birdWing: { position: "absolute", left: 12, width: 19, height: 5 },
  cactus: { position: "absolute" },
  cactusStem: { position: "absolute", width: "35%", height: "100%", left: "32%" },
  cactusArm: { position: "absolute", top: 15, width: "45%", height: 14 },
});
