import { describe, expect, it } from "vitest";
import {
  advanceRunner,
  createRunnerRun,
  emptyRunnerProgress,
  finishRunner,
  jumpRunner,
  parseRunnerProgress,
  runnerPoints,
  runnerSpeed,
  DINO_X,
  type RunnerObstacle,
  type RunnerRun,
} from "./dino-runner-engine";

describe("Dino runner physics and saved progress", () => {
  it("runs faster over time and ends on a cactus collision", () => {
    let run = createRunnerRun(12);
    for (let frame = 0; frame < 1000 && !run.over; frame++) run = advanceRunner(run, 1 / 60);
    expect(run.over).toBe(true);
    expect(run.distance).toBeGreaterThan(400);
    expect(runnerPoints(run)).toBeGreaterThan(40);
    expect(advanceRunner(run, 0.1)).toBe(run);
    const early = advanceRunner(createRunnerRun(), 0.1).distance;
    const late =
      advanceRunner({ ...createRunnerRun(), elapsed: 60, distance: 30000 }, 0.1).distance - 30000;
    expect(late).toBeGreaterThan(early * 2.5);
  });

  it("accelerates visibly within 15 seconds, keeps accelerating, and has a fair speed limit", () => {
    expect(runnerSpeed({ elapsed: 15 })).toBeGreaterThan(runnerSpeed({ elapsed: 0 }) * 1.4);
    expect(runnerSpeed({ elapsed: 30 })).toBeGreaterThan(runnerSpeed({ elapsed: 15 }));
    expect(runnerSpeed({ elapsed: 60 })).toBeGreaterThan(runnerSpeed({ elapsed: 30 }));
    expect(runnerSpeed({ elapsed: 100000 })).toBe(600);
  });

  it("advances at the same speed and produces the same obstacles at 30 and 120 fps", () => {
    const play = (fps: number) => {
      let run = { ...createRunnerRun(42), elapsed: 30, nextSpawn: 0 };
      for (let i = 0; i < fps; i++) run = advanceRunner(run, 1 / fps);
      return run;
    };
    const slow = play(30),
      fast = play(120);
    expect(slow.distance).toBeCloseTo(fast.distance, 7);
    expect(slow.elapsed).toBeCloseTo(fast.elapsed, 7);
    expect(slow.seed).toBe(fast.seed);
    expect(slow.obstacles.length).toBe(fast.obstacles.length);
    slow.obstacles.forEach((obstacle, i) => expect(obstacle.x).toBeCloseTo(fast.obstacles[i].x, 7));
  });

  it("unlocks groups and birds gradually and keeps every generated encounter clearable", () => {
    const seen = new Set<string>();
    for (const elapsed of [0, 15, 35, 65]) {
      for (let seed = 1; seed <= 64; seed++) {
        const spawned = advanceRunner(
          { ...createRunnerRun(Math.imul(seed, 2654435761)), elapsed, nextSpawn: 0 },
          1 / 120,
        );
        const obstacle = spawned.obstacles[0];
        expect(obstacle).toBeDefined();
        if (elapsed < 10) expect(obstacle.count).toBe(1);
        if (elapsed < 25) expect(obstacle.kind).toBe("cactus");
        const pattern = `${obstacle.kind}:${obstacle.count ?? 1}:${obstacle.bottom ?? 0}`;
        seen.add(pattern);
        expect(spawned.nextSpawn).toBeGreaterThanOrEqual(1);

        // Search for a valid single-tap timing, rather than assuming that a gap is fair.
        let clearable = false;
        for (let delay = 0; delay <= 1 && !clearable; delay += 1 / 30) {
          let run: RunnerRun = {
            ...createRunnerRun(1),
            elapsed,
            nextSpawn: 3,
            obstacles: [{ ...obstacle, x: 200 }],
          };
          for (let frame = 0; frame < 216 && !run.over; frame++) {
            if (frame === Math.round(delay * 120) && obstacle.bottom !== 60) run = jumpRunner(run);
            run = advanceRunner(run, 1 / 120);
          }
          clearable = !run.over && run.obstacles.every((item) => item.x + item.width < DINO_X);
        }
        expect(clearable, `Unclearable pattern ${pattern} at ${elapsed}s`).toBe(true);
      }
    }
    expect(seen).toEqual(
      new Set(["cactus:1:0", "cactus:2:0", "cactus:3:0", "bird:1:14", "bird:1:60"]),
    );
  });

  it("ends unattended early and fast runs and keeps the final score frozen", () => {
    for (const elapsed of [0, 30, 65]) {
      for (const seed of [1, 12, 42, 987]) {
        let run = { ...createRunnerRun(seed), elapsed };
        for (let frame = 0; frame < 1800 && !run.over; frame++) run = advanceRunner(run, 1 / 60);
        expect(run.over).toBe(true);
        expect(advanceRunner(run, 0.1)).toBe(run);
      }
    }
  });

  it("allows running under a high bird but catches a jumping collision and low bird", () => {
    const bird: RunnerObstacle = { kind: "bird", x: 80, width: 36, height: 24, bottom: 60 };
    const grounded = { ...createRunnerRun(1), obstacles: [bird] };
    expect(advanceRunner(grounded, 0.1).over).toBe(false);
    expect(advanceRunner({ ...grounded, y: 45 }, 0.1).over).toBe(true);
    expect(advanceRunner({ ...grounded, obstacles: [{ ...bird, bottom: 14 }] }, 0.1).over).toBe(
      true,
    );
  });

  it("allows one jump, clears a cactus, and lands without double jumping", () => {
    const initial = { ...createRunnerRun(), obstacles: [{ x: 120, width: 24, height: 38 }] };
    let run = advanceRunner(jumpRunner(initial), 0.1);
    expect(run.y).toBeGreaterThan(0);
    expect(jumpRunner(run)).toBe(run);
    for (let frame = 0; frame < 50; frame++) run = advanceRunner(run, 1 / 60);
    expect(run.over).toBe(false);
    expect(run.y).toBe(0);
    expect(run.velocity).toBe(0);
    expect(jumpRunner(run).velocity).toBe(470);
  });

  it("does not skip a nearby obstacle on a late frame or accept invalid deltas", () => {
    const run = { ...createRunnerRun(), obstacles: [{ x: 86, width: 20, height: 40 }] };
    expect(advanceRunner(run, 2).over).toBe(true);
    expect(advanceRunner(run, Number.NaN)).toBe(run);
    expect(advanceRunner(run, -1)).toBe(run);
  });

  it("restores an airborne run and its random sequence exactly", () => {
    let run = createRunnerRun(42);
    for (let frame = 0; frame < 85; frame++) run = advanceRunner(run, 1 / 60);
    run = advanceRunner(jumpRunner(run), 0.1);
    const progress = { ...emptyRunnerProgress(), run };
    const restored = parseRunnerProgress(JSON.stringify(progress));
    expect(restored).toEqual(progress);
    expect(advanceRunner(restored.run!, 0.1)).toEqual(advanceRunner(run, 0.1));
  });

  it("keeps just the best completed run and does not replace it with a lower score", () => {
    let progress = emptyRunnerProgress();
    for (let index = 1; index <= 12; index++) {
      progress = finishRunner(
        progress,
        { ...createRunnerRun(), distance: index * 100, over: true },
        "2026-10-15T10:00:00.000Z",
      );
    }
    expect(progress.run).toBeNull();
    expect(progress.scores.map((score) => score.points)).toEqual([120]);
    expect(
      finishRunner(progress, { ...createRunnerRun(), distance: 100, over: true }).scores,
    ).toEqual(progress.scores);
    expect(parseRunnerProgress(JSON.stringify(progress))).toEqual(progress);
  });

  it("migrates the old list to its highest score while retaining the saved run", () => {
    const run = { ...createRunnerRun(42), distance: 1230, y: 35, velocity: 80 };
    const at = "2026-10-15T10:00:00Z";
    const saved = JSON.stringify({
      version: 1,
      run,
      scores: [
        { points: 329, at },
        { points: 987, at },
        { points: 123, at },
      ],
    });
    expect(parseRunnerProgress(saved)).toEqual({
      version: 1,
      run,
      scores: [{ points: 987, at }],
    });
  });

  it("restores mixed obstacles, difficulty, and RNG without resetting the record", () => {
    const progress = {
      version: 1 as const,
      scores: [{ points: 987, at: "2026-10-15T12:00:00Z" }],
      run: {
        ...createRunnerRun(42),
        elapsed: 45,
        distance: 16000,
        nextSpawn: 0.7,
        obstacles: [
          { kind: "bird" as const, bottom: 60, width: 36, height: 24, x: 250 },
          { kind: "cactus" as const, count: 3 as const, bottom: 0, width: 84, height: 46, x: 500 },
        ],
      },
    };
    const restored = parseRunnerProgress(JSON.stringify(progress));
    expect(restored).toEqual(progress);
    expect(runnerSpeed(restored.run!)).toBe(runnerSpeed(progress.run));
    expect(advanceRunner(restored.run!, 0.1)).toEqual(advanceRunner(progress.run, 0.1));
    expect(
      parseRunnerProgress(
        JSON.stringify({
          ...progress,
          run: { ...progress.run, obstacles: [{ ...progress.run.obstacles[0], bottom: -10 }] },
        }),
      ).run,
    ).toBeNull();
  });

  it("recovers malformed data without allowing invalid physics or scores", () => {
    for (const raw of [null, "", "{", "null", "[]", '{"version":2,"scores":[]}']) {
      expect(parseRunnerProgress(raw)).toEqual(emptyRunnerProgress());
    }
    const validScore = { points: 123, at: "2026-10-15T10:00:00Z" };
    const saved = JSON.stringify({
      version: 1,
      run: { ...createRunnerRun(), y: -1 },
      scores: [validScore, { points: -1, at: "bad" }, { points: 1.2, at: validScore.at }],
    });
    expect(parseRunnerProgress(saved)).toEqual({ version: 1, run: null, scores: [validScore] });
  });
});
