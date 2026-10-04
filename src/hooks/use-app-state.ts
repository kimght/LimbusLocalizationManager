import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { AppState, SettingsPatch } from "@/stores/models";
import { toastError } from "@/components/toast/toast";
import i18n, { languageNames } from "@/i18n";
import { useMemo } from "react";

export function useAppState() {
  return useQuery({
    queryKey: ["appState"],
    queryFn: () => invoke<AppState>("get_app_state"),
  });
}

export function useCurrentVersion() {
  return useQuery({
    queryKey: ["currentVersion"],
    queryFn: () => getVersion(),
    staleTime: Infinity,
  });
}

export function useLatestVersion() {
  return useQuery({
    queryKey: ["latestVersion"],
    queryFn: async () => {
      const version = await invoke<string>("get_latest_version");
      return version.startsWith("v") ? version.slice(1) : version;
    },
    staleTime: 60_000,
  });
}

export function useIsUpdateAvailable() {
  const { data: current } = useCurrentVersion();
  const { data: latest } = useLatestVersion();

  return useMemo(
    () => current != null && latest != null && current !== latest,
    [current, latest]
  );
}

export function useSettings() {
  const { data } = useAppState();
  return data?.settings;
}

export function useLanguage() {
  const settings = useSettings();
  return (settings?.language ?? i18n.language) as keyof typeof languageNames;
}

export function useInstalled() {
  const { data } = useAppState();
  return data?.installed_metadata?.installed ?? {};
}

export function useHasInstalledLocalizations() {
  const installed = useInstalled();
  return Object.keys(installed).length > 0;
}

export function useGameDirectory() {
  const settings = useSettings();
  return settings?.game_directory ?? null;
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: SettingsPatch) => invoke("update_settings", { patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
      queryClient.invalidateQueries({ queryKey: ["localizations"] });
    },
    onError: () => {
      toastError(i18n.t("error.updateSettings"));
    },
  });
}

export function useSetGameDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (directory: string | null) =>
      invoke("set_game_directory", { directory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
    },
  });
}
