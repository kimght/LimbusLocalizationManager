import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class Smile implements Weapon {
  public readonly id = WeaponIds.Smile;
  public readonly name = "glupo.weapons.smile";
  public readonly description = "glupo.weapons.smileDescription";
  public readonly image = "weapon.smile";
  public readonly cooldown = 500;
  public readonly critMultiplier = 6;
  public readonly boxPrice = 100;
  public readonly cost = 200_000;
  public readonly chainPosition = { x: 500, y: 140 };

  public readonly stats: Stats = {
    fortitude: 5,
    prudence: 0,
    temperance: 0,
    justice: 0,
  };

  public onHit(store: GlupoStore, { position }: HitParams) {
    const game = store.game;

    // Better at lower sanity
    if (game.sanityState.current >= store.stats!.maxSanity / 2) {
      game.changeSanity(-25);
      return;
    }

    game.changeSanity(-5);
    let bonus = 5000;
    bonus = Math.floor(bonus / 2 + (Math.random() * bonus) / 2);

    game.spawnBoxes(position, Math.ceil(bonus / 1000), {
      size: 64,
    });
  }
}
