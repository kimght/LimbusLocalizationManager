import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class Heaven implements Weapon {
  public readonly id = WeaponIds.Heaven;
  public readonly name = "glupo.weapons.heaven";
  public readonly description = "glupo.weapons.heavenDescription";
  public readonly image = "weapon.heaven";
  public readonly cooldown = 500;
  public readonly critMultiplier = 2;
  public readonly boxPrice = 6;
  public readonly cost = 6_000;
  public readonly chainPosition = { x: 265, y: 26 };

  public readonly stats: Stats = {
    fortitude: 0,
    prudence: 0,
    temperance: 0,
    justice: 0,
  };

  // Vertical hits give bonus
  public onHit(store: GlupoStore, { position, isCritical }: HitParams) {
    const game = store.game;
    const hitAngle = Math.abs(store.game.weapon.data.angle);

    game.changeSanity(-2);

    if (hitAngle > 0.05) {
      return;
    }

    let bonus;
    if (hitAngle < 0.01) {
      bonus = 4;
    } else if (hitAngle < 0.02) {
      bonus = 2;
    } else {
      bonus = 1;
    }

    store.addBoxes(bonus, isCritical ? 2 : 1);
    game.spawnBoxes(position, bonus, {
      size: isCritical ? 48 : 32,
      asset: "ui.heaven-bonus",
      gravity: 0.1,
    });
  }
}
