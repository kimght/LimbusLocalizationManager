import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class Harvest implements Weapon {
  public readonly id = WeaponIds.Harvest;
  public readonly name = "glupo.weapons.harvest";
  public readonly description = "glupo.weapons.harvestDescription";
  public readonly image = "weapon.harvest";
  public readonly cooldown = 600;
  public readonly critMultiplier = 6;
  public readonly boxPrice = 3;
  public readonly cost = 3_000;
  public readonly chainPosition = { x: 235, y: 32 };

  public readonly stats: Stats = {
    fortitude: 0,
    prudence: 2,
    temperance: 0,
    justice: 0,
  };

  public onHit(store: GlupoStore, { position, isCritical }: HitParams) {
    const game = store.game;
    game.changeSanity(-15);

    let bonus = 0;
    if (store.playerStats!.prudence < 5) {
      bonus = 64;
    } else if (store.playerStats!.prudence === 0) {
      bonus = 128;
    }

    if (isCritical) {
      bonus = bonus * this.critMultiplier;
    }

    bonus = Math.floor(bonus / 2 + (Math.random() * bonus) / 2);

    store.addBalance(bonus);
    game.spawnBoxes(position, Math.ceil(bonus / 64), {
      size: 48,
      asset: "ui.box-harvest",
    });
  }
}
