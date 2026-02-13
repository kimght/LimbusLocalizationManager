import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Progress } from "@/stores/models";

export function usePlayProgress() {
  const [progressLog, setProgressLog] = useState<Progress[]>([]);

  const clearLog = useCallback(() => {
    setProgressLog([]);
  }, []);

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(
      listen("play:started", () => {
        setProgressLog([{ type: "started" }]);
      })
    );

    unlisteners.push(
      listen<string>("play:unknown_localization", (event) => {
        setProgressLog((prev) => [
          ...prev,
          { type: "unknown_localization", localization: event.payload },
        ]);
      })
    );

    unlisteners.push(
      listen<string>("play:up_to_date", (event) => {
        setProgressLog((prev) => [
          ...prev,
          { type: "up_to_date", localization: event.payload },
        ]);
      })
    );

    unlisteners.push(
      listen<string>("play:updating", (event) => {
        setProgressLog((prev) => [
          ...prev,
          { type: "updating", localization: event.payload },
        ]);
      })
    );

    unlisteners.push(
      listen<string>("play:update_finished", (event) => {
        setProgressLog((prev) => [
          ...prev,
          { type: "update_finished", localization: event.payload },
        ]);
      })
    );

    unlisteners.push(
      listen("play:starting_game", () => {
        setProgressLog((prev) => [...prev, { type: "starting_game" }]);
      })
    );

    unlisteners.push(
      listen("play:finished", () => {
        setProgressLog((prev) => [...prev, { type: "finished" }]);
      })
    );

    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten.then((fn) => fn());
      });
    };
  }, []);

  return { progressLog, clearLog };
}
