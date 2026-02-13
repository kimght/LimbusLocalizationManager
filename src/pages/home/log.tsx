import type { Progress } from "@/stores/models";
import { useTranslation } from "react-i18next";
import styles from "./log.module.css";
import { NavLink } from "react-router";

function Log({ progress }: { progress: Progress }) {
  const { t } = useTranslation();

  switch (progress.type) {
    case "started":
      return <span className={styles.log}>{t("log.started")}</span>;
    case "unknown_localization":
      return (
        <span className={styles.log}>
          {t("log.unknownLocalization", {
            localization: progress.localization,
          })}
        </span>
      );
    case "up_to_date":
      return (
        <span className={styles.log}>
          {t("log.upToDate", { localization: progress.localization })}
        </span>
      );
    case "updating":
      return (
        <span className={styles.log}>
          {t("log.updating", { localization: progress.localization })}:{" "}
          <NavLink to={`/localizations/${progress.localization}`}>
            {t("log.readChangeLog")}
          </NavLink>
        </span>
      );
    case "update_finished":
      return (
        <span className={styles.log}>
          {t("log.updateFinished", { localization: progress.localization })}
        </span>
      );
    case "starting_game":
      return <span className={styles.log}>{t("log.startingGame")}</span>;
    case "finished":
      return <span className={styles.log}>{t("log.finished")}</span>;
    default: {
      const exhaustiveCheck: never = progress;
      return <span className={styles.log}>{exhaustiveCheck}</span>;
    }
  }
}

export default Log;
