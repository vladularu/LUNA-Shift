import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  advanceRunner,
  createRunnerRun,
  emptyRunnerProgress,
  finishRunner,
  jumpRunner,
  type RunnerRun,
  type RunnerScore,
} from "./dino-runner-engine";
import { loadRunnerProgress, saveRunnerProgress } from "./dino-runner-storage";

export function useDinoRunner() {
  const db = useSQLiteContext();
  const progress = useRef(emptyRunnerProgress());
  const current = useRef(createRunnerRun());
  const playingRef = useRef(false);
  const loadedRef = useRef(false);
  const mounted = useRef(false);
  const [run, setRun] = useState<RunnerRun>(createRunnerRun);
  const [scores, setScores] = useState<readonly RunnerScore[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const persist = useCallback(() => {
    if (!loadedRef.current) return;
    void saveRunnerProgress(db, progress.current).then(
      () => {
        if (mounted.current) setError(null);
      },
      () => {
        if (mounted.current) setError("Spielstand nicht gespeichert. Zum Wiederholen tippen.");
      },
    );
  }, [db]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void loadRunnerProgress(db).then(
      (saved) => {
        if (!active) return;
        progress.current = saved;
        current.current = saved.run ?? createRunnerRun();
        loadedRef.current = true;
        setRun(current.current);
        setScores(saved.scores);
        setLoaded(true);
        setError(null);
        playingRef.current = true;
        setPlaying(true);
      },
      () => {
        if (active) setError("Spielstand konnte nicht geladen werden.");
      },
    );
    return () => {
      active = false;
      mounted.current = false;
      playingRef.current = false;
      persist();
    };
  }, [db, persist, revision]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous: number | null = null;
    let lastSave = 0;
    const tick = (time: number) => {
      if (!playingRef.current) return;
      const seconds = previous === null ? 0 : (time - previous) / 1000;
      previous = time;
      const next = advanceRunner(current.current, seconds);
      current.current = next;
      setRun(next);
      if (next.over) {
        playingRef.current = false;
        progress.current = finishRunner(progress.current, next);
        setScores(progress.current.scores);
        setPlaying(false);
        persist();
        return;
      }
      progress.current = { ...progress.current, run: next };
      if (time - lastSave >= 1000) {
        lastSave = time;
        persist();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, persist]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    persist();
  }, [persist]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") pause();
    });
    return () => subscription.remove();
  }, [pause]);

  function start() {
    if (!loadedRef.current || playingRef.current) return;
    if (current.current.over) current.current = createRunnerRun();
    progress.current = { ...progress.current, run: current.current };
    playingRef.current = true;
    setRun(current.current);
    setPlaying(true);
  }

  function jump() {
    if (!playingRef.current) return;
    current.current = jumpRunner(current.current);
    progress.current = { ...progress.current, run: current.current };
    setRun(current.current);
  }

  return {
    run,
    playing,
    loaded,
    error,
    scores,
    start,
    jump,
    pause,
    retry: () => (loadedRef.current ? persist() : setRevision((value) => value + 1)),
  };
}
