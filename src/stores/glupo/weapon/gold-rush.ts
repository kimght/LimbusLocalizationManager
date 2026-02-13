import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class GoldRush implements Weapon {
  public readonly id = WeaponIds.GoldRush;
  public readonly name = "glupo.weapons.goldRush";
  public readonly description = "glupo.weapons.goldRushDescription";
  public readonly image = "weapon.gold-rush";
  public readonly cooldown = 100;
  public readonly critMultiplier = 3;
  public readonly boxPrice = 10;
  public readonly cost = 12_000;
  public readonly chainPosition = { x: 128, y: 60 };

  public readonly stats: Stats = {
    fortitude: 4,
    prudence: 0,
    temperance: -2,
    justice: 0,
  };

  public onHit(store: GlupoStore, { isCritical }: HitParams) {
    const game = store.game;
    game.changeSanity(-1);

    if (isCritical) {
      game.changeSanity(-2);
    }
  }
}
