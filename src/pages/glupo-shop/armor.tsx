import { rootStore } from "@/stores";
import { observer } from "mobx-react-lite";
import styles from "./armor.module.css";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { ArmorId } from "@/stores/glupo/armor";
import { formatEnkephalin } from "@/utils";

function Armor() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const assets = glupo.game.store.imageAssets!;

  const { balance, boughtArmor } = glupo.gameData!;

  return (
    <div className={styles.container}>
      {glupo.armorShop.map((armor) => (
        <button
          key={armor.id}
          className={styles.armor}
          onClick={() => handleArmorClick(armor.id)}
          disabled={!armor.isBought && balance < armor.cost}
        >
          <div className={styles.image}>
            <img src={assets[armor.image].src} alt={armor.name} />
          </div>
          <div className={styles.info}>
            <h3>{t(armor.name)}</h3>
            <p>{t(armor.description)}</p>
          </div>
          <div>
            {armor.isSelected && (
              <Check className="w-6 h-6 shrink-0 text-limbus-500" />
            )}
            {!armor.isBought && <p>{formatEnkephalin(armor.cost)}</p>}
          </div>
        </button>
      ))}
    </div>
  );

  function handleArmorClick(armorId: ArmorId) {
    if (boughtArmor.includes(armorId)) {
      glupo.selectArmor(armorId);
    } else {
      glupo.buyArmor(armorId);
    }
  }
}

export default observer(Armor);
