import { useEffect, useRef } from "react";
import styles from "./console.module.css";
import { useTranslation } from "react-i18next";
import Log from "./log";
import { usePlayProgress } from "@/hooks/use-play-progress";

function Console() {
  const { progressLog } = usePlayProgress();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    ref.current.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [progressLog.length]);

  return (
    <div className={styles.console}>
      <span className={styles.title}>{t("home.console")}</span>
      <div className={styles.container} ref={ref}>
        {progressLog.map((log, index) => (
          <Log key={index} progress={log} />
        ))}
      </div>
    </div>
  );
}

export default Console;
