import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import styles from "./trinkets.module.css";
import { rootStore } from "@/stores";
import { TrinketRarity } from "@/stores/glupo/trinket";
import { cn } from "@/utils";

function Trinkets() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const trinketList = glupo.trinketList;
  const selectedTrinket = glupo.gameData!.selectedTrinket;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t("glupo.light-shop.trinket-special")}</h2>
      <div className={styles.grid}>
        {trinketList[TrinketRarity.Special].map((trinket) => (
          <button
            key={trinket.id}
            className={cn(
              styles.button,
              !trinket.isBought && styles.locked,
              selectedTrinket === trinket.id && styles.selected
            )}
            onClick={() => glupo.selectTrinket(trinket.id)}
          >
            <img src={trinket.image} width={64} height={64} alt={trinket.id} />
          </button>
        ))}
      </div>
      <h2 className={styles.title}>{t("glupo.light-shop.trinket-rare")}</h2>
      <div className={styles.grid}>
        {trinketList[TrinketRarity.Rare].map((trinket) => (
          <button
            key={trinket.id}
            className={cn(
              styles.button,
              !trinket.isBought && styles.locked,
              selectedTrinket === trinket.id && styles.selected
            )}
            onClick={() => glupo.selectTrinket(trinket.id)}
          >
            <img src={trinket.image} width={64} height={64} alt={trinket.id} />
          </button>
        ))}
      </div>
      <h2 className={styles.title}>{t("glupo.light-shop.trinket-common")}</h2>
      <div className={styles.grid}>
        {trinketList[TrinketRarity.Common].map((trinket) => (
          <button
            key={trinket.id}
            className={cn(
              styles.button,
              !trinket.isBought && styles.locked,
              selectedTrinket === trinket.id && styles.selected
            )}
            onClick={() => glupo.selectTrinket(trinket.id)}
          >
            <img src={trinket.image} width={64} height={64} alt={trinket.id} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default observer(Trinkets);
