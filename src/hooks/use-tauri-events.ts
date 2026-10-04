import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import i18n from "@/i18n";
import { AppState, RemoteLocalizations } from "@/stores/models";
import { useAppState } from "@/hooks/use-app-state";

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
      listen<RemoteLocalizations>("remote_localizations_updated", (event) => {
        // `get_available_localizations` emits this too; refetching on that echo would
        // loop, so refresh only when another command brought a different catalog.
        const cached = queryClient.getQueryData<{
          localizations: RemoteLocalizations["localizations"];
        }>(["localizations"]);
        const changed =
          JSON.stringify(cached?.localizations) !==
          JSON.stringify(event.payload.localizations);

        if (
          changed &&
          queryClient.isFetching({ queryKey: ["localizations"] }) === 0
        ) {
          queryClient.invalidateQueries({ queryKey: ["localizations"] });
        }
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
  const { data: appState } = useAppState();
  const language = appState?.settings?.language;

  useEffect(() => {
    if (language) {
      i18n.changeLanguage(language);
    }
  }, [language]);
}
