import { observer } from "mobx-react-lite";
import { rootStore } from "@/stores";
import styles from "./page.module.css";
import { useTranslation } from "react-i18next";

import Enkephalin from "@/assets/icons/glupo/ui/enkephalin.webp";
import { cn, formatEnkephalin } from "@/utils";
import { NavLink } from "react-router";
import { ChevronsLeft } from "lucide-react";
import Stats from "./stats";
import Risk from "./risk";
import Weapons from "./weapons";
import Armor from "./armor";
import Reset from "./reset";
import Light from "./light";

function Page() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  if (glupo.isLoading) {
    return (
      <div className={styles.loading}>
        <p>{t("glupo.loading")}</p>
      </div>
    );
  }

  const { balance, loopCount } = glupo.gameData!;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <NavLink to="/about/glupo" replace className={styles.back}>
          <ChevronsLeft className="w-6 h-6 shrink-0" />
          <h1>{t("glupo.shop.title")}</h1>
        </NavLink>

        <div className={cn(styles.balance, glupo.isFullBalance && styles.full)}>
          <p>
            {formatEnkephalin(balance)}/
            {formatEnkephalin(glupo.maxBalance, "∞")}
          </p>
          <button onClick={glupo.cheat}>
            <img src={Enkephalin} alt="Enkephalin" width={48} height={24} />
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {loopCount > 0 && (
          <div className={styles.section}>
            <h2>{t("glupo.shop.section.light")}</h2>
            <Light />
          </div>
        )}

        <div className={styles.section}>
          <h2>{t("glupo.shop.section.stats")}</h2>
          <Stats />
        </div>

        <div className={styles.section}>
          <h2>{t("glupo.shop.section.risk")}</h2>
          <Risk />
        </div>

        <div className={styles.section}>
          <h2>{t("glupo.shop.section.weapons")}</h2>
          <Weapons />
        </div>

        <div className={styles.section}>
          <h2>{t("glupo.shop.section.armor")}</h2>
          <Armor />
        </div>

        <div className={styles.section}>
          <h2>{t("glupo.shop.section.reset")}</h2>
          <Reset />
        </div>
      </div>
    </div>
  );
}

export default observer(Page);
