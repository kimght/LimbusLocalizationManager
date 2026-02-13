import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Localization } from "@/stores/models";
import { toastError, toastSuccess } from "@/components/toast/toast";
import i18n from "@/i18n";
import { useCallback, useRef, useState } from "react";

export function useInstallLocalization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (localization: Localization) =>
      invoke("install_localization", { localization }),
    onSuccess: (_data, localization) => {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
      toastSuccess(
        i18n.t("localization.installed", {
          localization: localization.name,
          version: localization.version,
        })
      );
    },
    onError: (_error, localization) => {
      toastError(i18n.t("error.install", { localization: localization.name }));
    },
  });
}

export function useUninstallLocalization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (localization: Localization) =>
      invoke("uninstall_localization", { localization }),
    onSuccess: (_data, localization) => {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
      toastSuccess(
        i18n.t("localization.uninstalled", { localization: localization.name })
      );
    },
    onError: () => {
      toastError(i18n.t("error.uninstall"));
    },
  });
}

export function useRepairLocalization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (localization: Localization) =>
      invoke("repair_localization", { localization }),
    onSuccess: (_data, localization) => {
      queryClient.invalidateQueries({ queryKey: ["appState"] });
      toastSuccess(
        i18n.t("localization.repaired", { localization: localization.name })
      );
    },
    onError: () => {
      toastError(i18n.t("error.repair"));
    },
  });
}

export function useLocalizationStatus(localizationId: string) {
  const install = useInstallLocalization();
  const uninstall = useUninstallLocalization();
  const repair = useRepairLocalization();

  const isPending =
    (install.isPending && install.variables?.id === localizationId) ||
    (uninstall.isPending && uninstall.variables?.id === localizationId) ||
    (repair.isPending && repair.variables?.id === localizationId);

  return { install, uninstall, repair, isPending };
}

export function useUpdateAndPlay() {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const abortRef = useRef(false);

  const mutate = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    abortRef.current = false;

    try {
      await invoke("update_and_play");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toastError(i18n.t("error.updateAndPlay"));
    } finally {
      setIsPending(false);
      queryClient.invalidateQueries({ queryKey: ["appState"] });
    }
  }, [isPending, queryClient]);

  return { mutate, isPending };
}
