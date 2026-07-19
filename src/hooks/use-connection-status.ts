import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface ConnectionStatus {
  stage: "direct_failed" | "trying_address" | "connected" | "failed";
  host: string;
  address: string | null;
}

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    const unlisten = listen<ConnectionStatus>("connection_status", (event) => {
      if (
        event.payload.stage === "connected" ||
        event.payload.stage === "failed"
      ) {
        setStatus(null);
      } else {
        setStatus(event.payload);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return status;
}
