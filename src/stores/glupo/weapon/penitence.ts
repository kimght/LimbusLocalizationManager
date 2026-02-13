import { WeaponIds } from ".";
import { HitParams, Stats, Weapon } from "../types";
import { GlupoStore } from "../store";

export class Penitence implements Weapon {
  public readonly id = WeaponIds.Penitence;
  public readonly name = "glupo.weapons.penitence";
  public readonly description = "glupo.weapons.penitenceDescription";
  public readonly image = "weapon.penitence";
  public readonly cooldown = 250;
  public readonly critMultiplier = 1.5;
  public readonly boxPrice = 1;
  public readonly cost = 0;
  public readonly chainPosition = { x: 345, y: 78 };

  public readonly stats: Stats = {
    fortitude: 0,
    prudence: 0,
    temperance: 0,
    justice: 0,
  };

  public onHit(store: GlupoStore, { isCritical }: HitParams) {
    if (isCritical) {
      store.game.changeSanity(+5);
    } else {
      store.game.changeSanity(-4);
    }
  }
}
