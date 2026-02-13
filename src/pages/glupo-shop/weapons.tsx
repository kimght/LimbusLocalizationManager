import { rootStore } from "@/stores";
import { observer } from "mobx-react-lite";
import styles from "./weapons.module.css";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { WeaponId } from "@/stores/glupo/weapon";
import { formatEnkephalin } from "@/utils";

function Weapons() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const assets = glupo.game.store.imageAssets!;
  const { balance, boughtWeapons } = glupo.gameData!;

  return (
    <div className={styles.container}>
      {glupo.weaponsShop.map((weapon) => (
        <button
          key={weapon.id}
          className={styles.weapon}
          onClick={() => handleWeaponClick(weapon.id)}
          disabled={!weapon.isBought && balance < weapon.cost}
        >
          <div className={styles.image}>
            <img src={assets[weapon.image].src} alt={weapon.name} />
          </div>
          <div className={styles.info}>
            <h3>{t(weapon.name)}</h3>
            <p>{t(weapon.description)}</p>
          </div>
          <div>
            {weapon.isSelected && (
              <Check className="w-6 h-6 shrink-0 text-limbus-500" />
            )}
            {!weapon.isBought && <p>{formatEnkephalin(weapon.cost)}</p>}
          </div>
        </button>
      ))}
    </div>
  );

  function handleWeaponClick(weaponId: WeaponId) {
    if (boughtWeapons.includes(weaponId)) {
      glupo.selectWeapon(weaponId);
    } else {
      glupo.buyWeapon(weaponId);
    }
  }
}

export default observer(Weapons);
