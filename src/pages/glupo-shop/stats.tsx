import { rootStore } from "@/stores";
import styles from "./stats.module.css";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { formatEnkephalin } from "@/utils";

const formatNumber = (value: number) => {
  return value.toFixed(2).replace(/\.?0+$/, "");
};

function Stats() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const { baseStats } = glupo.gameData!;
  const totalStats = glupo.playerStats!;
  const maxStats = glupo.maxStats!;
  const upgradeCost = glupo.statsUpgradeCost;
  const canUpgrade = glupo.canUpgradeStats;
  const stats = glupo.stats!;

  return (
    <div className={styles.stats}>
      <div className={styles.container}>
        <button
          onClick={() => glupo.upgradeStats("fortitude")}
          className={styles.stat}
          disabled={!canUpgrade.fortitude}
          style={
            {
              "--progress": `${(baseStats.fortitude / maxStats.fortitude) * 100}%`,
            } as React.CSSProperties
          }
        >
          <p>{t("glupo.shop.stats.fortitude")}</p>
          <span>{formatEnkephalin(upgradeCost.fortitude, "max")}</span>
        </button>
        <div className={styles.description}>
          {t("glupo.shop.stats.fortitudeDescription", {
            base: baseStats.fortitude,
            total: totalStats.fortitude,
            min: stats.minBoxes,
            max: stats.maxBoxes,
          })}
        </div>
      </div>

      <div className={styles.container}>
        <button
          onClick={() => glupo.upgradeStats("prudence")}
          className={styles.stat}
          disabled={!canUpgrade.prudence}
          style={
            {
              "--progress": `${(baseStats.prudence / maxStats.prudence) * 100}%`,
            } as React.CSSProperties
          }
        >
          <p>{t("glupo.shop.stats.prudence")}</p>
          <span>{formatEnkephalin(upgradeCost.prudence, "max")}</span>
        </button>
        <div className={styles.description}>
          {t("glupo.shop.stats.prudenceDescription", {
            base: baseStats.prudence,
            total: totalStats.prudence,
            max: stats.maxSanity,
            regeneration: formatNumber(stats.regenerationDelay),
            panicRestore: formatNumber(stats.panicRestoreDelay),
          })}
        </div>
      </div>

      <div className={styles.container}>
        <button
          onClick={() => glupo.upgradeStats("temperance")}
          className={styles.stat}
          disabled={!canUpgrade.temperance}
          style={
            {
              "--progress": `${(baseStats.temperance / maxStats.temperance) * 100}%`,
            } as React.CSSProperties
          }
        >
          <p>{t("glupo.shop.stats.temperance")}</p>
          <span>{formatEnkephalin(upgradeCost.temperance, "max")}</span>
        </button>
        <div className={styles.description}>
          {t("glupo.shop.stats.temperanceDescription", {
            base: baseStats.temperance,
            total: totalStats.temperance,
            criticalChance: `${formatNumber(stats.criticalChance * 100)}%`,
            criticalMultiplier: `x${formatNumber(stats.criticalMultiplier)}`,
          })}
        </div>
      </div>

      <div className={styles.container}>
        <button
          onClick={() => glupo.upgradeStats("justice")}
          className={styles.stat}
          disabled={!canUpgrade.justice}
          style={
            {
              "--progress": `${(baseStats.justice / maxStats.justice) * 100}%`,
            } as React.CSSProperties
          }
        >
          <p>{t("glupo.shop.stats.justice")}</p>
          <span>{formatEnkephalin(upgradeCost.justice, "max")}</span>
        </button>
        <div className={styles.description}>
          {t("glupo.shop.stats.justiceDescription", {
            base: baseStats.justice,
            total: totalStats.justice,
            speedBonus: formatNumber((stats.cooldownModifier - 1) * 100),
            cooldown: formatNumber(stats.realCooldown),
            weaponCooldown: formatNumber(stats.cooldown),
          })}
        </div>
      </div>
    </div>
  );
}

export default observer(Stats);
