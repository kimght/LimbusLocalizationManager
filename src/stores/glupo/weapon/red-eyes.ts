import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";

export class RedEyes implements Weapon {
  public readonly id = WeaponIds.RedEyes;
  public readonly name = "glupo.weapons.redEyes";
  public readonly description = "glupo.weapons.redEyesDescription";
  public readonly image = "weapon.red-eyes";
  public readonly cooldown = 200;
  public readonly critMultiplier = 1.5;
  public readonly boxPrice = 1.5;
  public readonly cost = 1_200;
  public readonly chainPosition = { x: 355, y: 58 };

  public readonly stats: Stats = {
    fortitude: 4,
    prudence: 0,
    temperance: 0,
    justice: 0,
  };

  private spiderCount = 0;

  // Spawns temporary spiders that give +1 temperance
  public onHit(store: GlupoStore, { position }: HitParams) {
    const game = store.game;
    game.changeSanity(-6);

    if (Math.random() > 0.5 || this.spiderCount >= 3) {
      return;
    }

    this.spiderCount++;
    store.addBonusStats({
      temperance: 1,
    });

    game.particles.addParticle({
      x: position.x + Math.random() * 20 - 5,
      y: position.y + Math.random() * 20 - 5,
      asset: "ui.red-eyes-spider",
      timeLeft: Infinity,
      vx: 0,
      vy: 0,
      size: 40,
      opacity: 1,
      opacityDecay: 0.01,
      rotation: 0,
      hue: 0,
      gravity: 0,
      onDestroy: () => {
        this.spiderCount--;
        store.addBonusStats({
          temperance: -1,
        });
      },
    });
  }
}
