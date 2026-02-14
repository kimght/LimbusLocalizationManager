import { observer } from "mobx-react-lite";
import { rootStore } from "@/stores";
import styles from "./page.module.css";
import { useTranslation } from "react-i18next";

import LightShard from "@/assets/icons/glupo/ui/light-shard.webp";
import { NavLink } from "react-router";
import { ChevronsLeft } from "lucide-react";
import Gacha from "./gacha";
import Trinkets from "./trinkets";

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

  const { lightShards } = glupo.gameData!;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <NavLink to="/about/glupo/shop" replace className={styles.back}>
          <ChevronsLeft className="w-6 h-6 shrink-0" />
          <h1>{t("glupo.lightShop.title")}</h1>
        </NavLink>

        <div className={styles.balance}>
          <p>{lightShards}</p>
          <img src={LightShard} alt="Light Shard" width={32} height={32} />
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.section}>
          {/* <h2>{t("glupo.lightShop.trinket-gacha")}</h2> */}
          <Gacha />
        </div>

        <div className={styles.section}>
          {/* <h2>{t("glupo.lightShop.trinkets")}</h2> */}
          <Trinkets />
        </div>

        <button
          onClick={() =>
            glupo.updateGameData({ boughtTrinkets: [], selectedTrinket: null })
          }
        >
          Reset Trinkets
        </button>
      </div>
    </div>
  );
}

export default observer(Page);
