export const RUNNER_WIDTH = 480;
export const RUNNER_HEIGHT = 220;
export const RUNNER_GROUND = 176;
export const DINO_X = 48;
export const DINO_WIDTH = 36;
export const DINO_HEIGHT = 40;

export interface RunnerObstacle {
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly kind?: "cactus" | "bird";
  readonly count?: 1 | 2 | 3;
  readonly bottom?: number;
}

export interface RunnerRun {
  readonly distance: number;
  readonly elapsed: number;
  readonly y: number;
  readonly velocity: number;
  readonly nextSpawn: number;
  readonly seed: number;
  readonly obstacles: readonly RunnerObstacle[];
  readonly over: boolean;
}

export interface RunnerScore {
  readonly points: number;
  readonly at: string;
}

export interface RunnerProgress {
  readonly version: 1;
  readonly run: RunnerRun | null;
  readonly scores: readonly RunnerScore[];
}

export const emptyRunnerProgress = (): RunnerProgress => ({ version: 1, run: null, scores: [] });

export function createRunnerRun(seed = Date.now()): RunnerRun {
  return {
    distance: 0,
    elapsed: 0,
    y: 0,
    velocity: 0,
    nextSpawn: 1.2,
    seed: Math.floor(seed) >>> 0 || 1,
    obstacles: [],
    over: false,
  };
}

export const runnerPoints = (run: RunnerRun) => Math.floor(run.distance / 10);

// Elapsed game time makes acceleration independent of frame rate and resumable.
export const runnerSpeed = (run: Pick<RunnerRun, "elapsed">) =>
  Math.min(210 + run.elapsed * 6, 600);

function spawnRunnerObstacle(elapsed: number, random: () => number): RunnerObstacle {
  if (elapsed >= 25 && random() < 0.3) {
    return {
      x: RUNNER_WIDTH + 20,
      kind: "bird",
      width: 36,
      height: 24,
      bottom: random() < 0.5 ? 14 : 60,
    };
  }
  const large = random() < 0.5;
  const group = random();
  const count = elapsed >= 30 && group < 0.25 ? 3 : elapsed >= 10 && group < 0.6 ? 2 : 1;
  return {
    x: RUNNER_WIDTH + 20,
    kind: "cactus",
    count,
    bottom: 0,
    width: (large ? 24 : 18) * count + 6 * (count - 1),
    height: (large ? 40 : 28) + Math.floor(random() * 7),
  };
}

export function jumpRunner(run: RunnerRun): RunnerRun {
  return run.over || run.y > 0 ? run : { ...run, velocity: 470 };
}

// Small physics steps prevent tunnelling through cacti on a delayed frame.
export function advanceRunner(run: RunnerRun, seconds: number): RunnerRun {
  if (run.over || !Number.isFinite(seconds) || seconds <= 0) return run;
  let next = run;
  let remaining = Math.min(seconds, 0.1);
  while (remaining > 0 && !next.over) {
    const dt = Math.min(remaining, 1 / 120);
    remaining -= dt;
    const speed = runnerSpeed(next);
    const velocity = next.velocity - 1400 * dt;
    const y = Math.max(0, next.y + velocity * dt);
    let seed = next.seed;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const obstacles = next.obstacles
      .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * dt }))
      .filter((obstacle) => obstacle.x + obstacle.width > 0);
    let nextSpawn = next.nextSpawn - dt;
    if (nextSpawn <= 0) {
      obstacles.push(spawnRunnerObstacle(next.elapsed, random));
      // Even at maximum speed, a full jump/landing fits between encounters.
      nextSpawn = 1.45 - Math.min(next.elapsed / 60, 1) * 0.45 + random() * 0.55;
    }
    const over = obstacles.some(
      (obstacle) =>
        DINO_X + DINO_WIDTH - 6 > obstacle.x + 3 &&
        DINO_X + 6 < obstacle.x + obstacle.width - 3 &&
        y + 5 < (obstacle.bottom ?? 0) + obstacle.height &&
        y + DINO_HEIGHT - 4 > (obstacle.bottom ?? 0),
    );
    next = {
      distance: next.distance + speed * dt,
      elapsed: next.elapsed + dt,
      y,
      velocity: y === 0 ? 0 : velocity,
      obstacles,
      nextSpawn,
      seed,
      over,
    };
  }
  return next;
}

export function finishRunner(
  progress: RunnerProgress,
  run: RunnerRun,
  at = new Date().toISOString(),
): RunnerProgress {
  return {
    version: 1,
    run: null,
    scores: [...progress.scores, { points: runnerPoints(run), at }]
      .sort((a, b) => b.points - a.points || b.at.localeCompare(a.at))
      .slice(0, 1),
  };
}

const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseRunnerProgress(raw: string | null): RunnerProgress {
  if (!raw) return emptyRunnerProgress();
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.scores))
      return emptyRunnerProgress();
    const scores = value.scores
      .filter(
        (score): score is unknown & RunnerScore =>
          object(score) &&
          bounded(score.points, 0, 100000000) &&
          Number.isInteger(score.points) &&
          typeof score.at === "string" &&
          score.at.length <= 30 &&
          Number.isFinite(Date.parse(score.at)),
      )
      .sort((a, b) => b.points - a.points)
      .slice(0, 1);
    const run = value.run;
    const valid =
      object(run) &&
      bounded(run.distance, 0, 1000000000) &&
      bounded(run.elapsed, 0, 100000000) &&
      bounded(run.y, 0, 200) &&
      bounded(run.velocity, -2000, 2000) &&
      bounded(run.nextSpawn, 0, 3) &&
      bounded(run.seed, 0, 4294967295) &&
      Number.isInteger(run.seed) &&
      run.over === false &&
      Array.isArray(run.obstacles) &&
      run.obstacles.length <= 4 &&
      run.obstacles.every(
        (obstacle) =>
          object(obstacle) &&
          bounded(obstacle.x, -100, 600) &&
          bounded(obstacle.width, 16, 96) &&
          bounded(obstacle.height, 16, 46) &&
          (obstacle.kind === "bird"
            ? (obstacle.bottom === 14 || obstacle.bottom === 60) &&
              (obstacle.count === undefined || obstacle.count === 1)
            : (obstacle.kind === undefined || obstacle.kind === "cactus") &&
              (obstacle.bottom === undefined || obstacle.bottom === 0) &&
              (obstacle.count === undefined ||
                (bounded(obstacle.count, 1, 3) && Number.isInteger(obstacle.count)))),
      );
    return { version: 1, scores, run: valid ? (run as unknown as RunnerRun) : null };
  } catch {
    return emptyRunnerProgress();
  }
}
