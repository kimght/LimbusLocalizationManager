import { rootStore } from "@/stores";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import LightShard from "@/assets/icons/glupo/ui/light-shard.webp";
import styles from "./light.module.css";
import { NavLink } from "react-router";

function Light() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const { lightShards } = glupo.gameData!;

  return (
    <NavLink className={styles.container} to="/about/glupo/light">
      <p>{t("glupo.light-shop.button")}</p>
      <div className={styles.shards}>
        <span>{lightShards}</span>
        <img src={LightShard} alt="Light Shard" />
      </div>
    </NavLink>
  );
}

export default observer(Light);
