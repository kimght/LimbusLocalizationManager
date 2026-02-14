import styles from "./page.module.css";
import { ArrowDown, FileText, Folder, FolderOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { toastError } from "@/components/toast/toast";
import { languageNames } from "@/i18n";
import { useLocation } from "react-router";
import { cn, openConfigDir, openLogDir } from "@/utils";
import {
  useAppState,
  useLanguage,
  useGameDirectory,
  useUpdateSettings,
  useSetGameDirectory,
} from "@/hooks/use-app-state";

function Page() {
  const { t } = useTranslation();
  const { data: appState } = useAppState();
  const language = useLanguage();
  const gameDirectory = useGameDirectory();
  const { hash } = useLocation();
  const updateSettings = useUpdateSettings();
  const setGameDirectory = useSetGameDirectory();

  const settings = appState?.settings;

  return (
    <div className={styles.container}>
      <h1 className="text-xl">{t("settings.title")}</h1>

      <div className={styles.settings}>
        <div
          className={cn(
            styles.section,
            hash === "#interface-language" && styles.active
          )}
        >
          <h2>{t("settings.interfaceLanguage")}</h2>
          <div className={styles.select}>
            <select value={language} onChange={handleLanguageChange}>
              {Object.entries(languageNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            <ArrowDown strokeWidth={1.5} />
          </div>
        </div>

        <div className={styles.section}>
          <h2>{t("settings.source")}</h2>
          <div className={styles.select}>
            <select
              value={settings?.selected_source ?? undefined}
              onChange={handleSourceChange}
            >
              {settings?.sources &&
                Object.entries(settings.sources).map(([key, source]) => (
                  <option key={key} value={key}>
                    {source.name}
                  </option>
                ))}
            </select>
            <ArrowDown strokeWidth={1.5} />
          </div>
        </div>

        <div className={styles.section}>
          <h2>{t("settings.gameDirectory")}</h2>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              className={styles.input}
              value={gameDirectory ?? ""}
              placeholder={t("settings.gameDirectoryDefault")}
              disabled
            />
            {gameDirectory === null ? (
              <button
                className={styles.button}
                onClick={handleGameDirectoryPick}
              >
                <Folder />
              </button>
            ) : (
              <button
                className={styles.button}
                onClick={handleGameDirectoryClear}
              >
                <X />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.files}>
        <button className={styles.labeledButton} onClick={openLogDir}>
          <FolderOpen size={16} />
          {t("settings.openLogs")}
        </button>
        <button className={styles.labeledButton} onClick={openConfigDir}>
          <FileText size={16} />
          {t("settings.openConfig")}
        </button>
      </div>
    </div>
  );

  function handleSourceChange(event: React.ChangeEvent<HTMLSelectElement>) {
    if (!settings) return;
    updateSettings.mutate({
      ...settings,
      selected_source: event.target.value,
    });
  }

  async function handleGameDirectoryPick() {
    const directory = await open({
      directory: true,
      multiple: false,
    });

    if (!directory) {
      return;
    }

    setGameDirectory.mutate(directory, {
      onError: () => {
        toastError(t("error.setGameDirectory"));
      },
    });
  }

  function handleGameDirectoryClear() {
    setGameDirectory.mutate(null, {
      onError: () => {
        toastError(t("error.setGameDirectory"));
      },
    });
  }

  function handleLanguageChange(event: React.ChangeEvent<HTMLSelectElement>) {
    if (!settings) return;
    updateSettings.mutate({
      ...settings,
      language: event.target.value,
    });
  }
}

export default Page;
