import styles from "./page.module.css";
import { useTranslation } from "react-i18next";
import Console from "./console";
import { cn } from "@/utils";
import { Languages } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import {
  useCurrentVersion,
  useIsUpdateAvailable,
  useHasInstalledLocalizations,
} from "@/hooks/use-app-state";
import { useUpdateAndPlay } from "@/hooks/use-actions";

function Page() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: currentVersion } = useCurrentVersion();
  const isUpdateAvailable = useIsUpdateAvailable();
  const hasInstalled = useHasInstalledLocalizations();
  const { mutate: updateAndPlay, isPending: startingGame } = useUpdateAndPlay();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        {currentVersion && (
          <span className={styles.version}>
            v{currentVersion}{" "}
            {isUpdateAvailable && (
              <a
                href={`${import.meta.env.VITE_APP_REPO_URL}/releases/latest`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("home.updateAvailable")}
              </a>
            )}
          </span>
        )}

        <NavLink to="/settings#interface-language" className={styles.language}>
          <Languages />
        </NavLink>
      </div>

      <div className={styles.main}>
        <img src="/star.png" alt="logo" className={styles.logo} />

        <span className={styles.title}>{t("home.title")}</span>

        {!hasInstalled && (
          <span className={styles.subtitle}>
            {t("home.noLocalizationsInstalled")}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <button
          className={cn(styles.play, startingGame && styles.loading)}
          onClick={handleClick}
          disabled={startingGame}
        >
          {hasInstalled ? t("home.play") : t("home.add")}
        </button>
        <Console />
      </div>
    </div>
  );

  async function handleClick() {
    if (!hasInstalled) {
      navigate("/localizations");
      return;
    }

    updateAndPlay();
  }
}

export default Page;
