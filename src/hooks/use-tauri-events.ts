import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import i18n from "@/i18n";
import { AppState } from "@/stores/models";

export function useTauriQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    unlisteners.push(
      listen<AppState>("app_state_updated", (event) => {
        queryClient.setQueryData(["appState"], event.payload);
      })
    );

    unlisteners.push(
      listen("remote_localizations_updated", () => {
        queryClient.invalidateQueries({ queryKey: ["localizations"] });
      })
    );

    return () => {
      unlisteners.forEach((unlisten) => {
        unlisten.then((fn) => fn());
      });
    };
  }, [queryClient]);
}

export function useLanguageSync() {
  const queryClient = useQueryClient();
  const appState = queryClient.getQueryData<AppState>(["appState"]);
  const language = appState?.settings?.language;

  useEffect(() => {
    if (language) {
      i18n.changeLanguage(language);
    }
  }, [language]);
}
