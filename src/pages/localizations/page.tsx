import styles from "./page.module.css";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { cn } from "@/utils";
import { useLocalizations } from "@/hooks/use-localizations";

function Page() {
  const { all, flags, isLoading, isFetching, error, refetch } =
    useLocalizations();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <p>{t("localizations.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <span>{t("localizations.error")}</span>
        <div className={styles.actions}>
          <button onClick={tryAgain}>{t("localizations.tryAgain")}</button>
          <button onClick={() => navigate("/settings", { replace: true })}>
            {t("localizations.changeSource")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <button
          className={styles.refresh}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={cn(isFetching && styles.spinning)} />
          {t("localizations.refresh")}
        </button>
        <div className={styles.list}>
          {all.map((localization) => (
            <NavLink
              key={localization.id}
              to={`/localizations/${localization.id}`}
              className={({ isActive }) =>
                cn(styles.item, isActive && styles.active)
              }
            >
              <img
                src={flags[localization.id]}
                alt={localization.name}
                className="!w-6 !h-4 shrink-0"
              />
              <span>{localization.name}</span>
            </NavLink>
          ))}
        </div>
      </div>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );

  function tryAgain() {
    refetch();
  }
}

export default Page;
