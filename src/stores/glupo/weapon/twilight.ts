import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class Twilight implements Weapon {
  public readonly id = WeaponIds.Twilight;
  public readonly name = "glupo.weapons.twilight";
  public readonly description = "glupo.weapons.twilightDescription";
  public readonly image = "weapon.twilight";
  public readonly cooldown = 250;
  public readonly critMultiplier = 4;
  public readonly boxPrice = 60;
  public readonly cost = 1_250_000;
  public readonly chainPosition = { x: 495, y: 48 };

  public readonly stats: Stats = {
    fortitude: 5,
    prudence: 5,
    temperance: 5,
    justice: 5,
  };

  public onHit(store: GlupoStore, { isCritical }: HitParams) {
    store.game.changeSanity(-6);

    if (isCritical) {
      store.addBonusStats({
        fortitude: 0,
        prudence: 0,
        temperance: 1,
        justice: 1,
      });

      setTimeout(() => {
        store.addBonusStats({
          fortitude: 0,
          prudence: 0,
          temperance: -1,
          justice: -1,
        });
      }, 2500);
    }
  }
}
