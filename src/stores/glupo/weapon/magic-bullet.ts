import { WeaponIds } from ".";
import { Stats, Weapon } from "../types";
import { GlupoStore } from "../store";
import { HitParams } from "../types";
import { randomRangeInt } from "../utils";

export class MagicBullet implements Weapon {
  public readonly id = WeaponIds.MagicBullet;
  public readonly name = "glupo.weapons.magicBullet";
  public readonly description = "glupo.weapons.magicBulletDescription";
  public readonly image = "weapon.magic-bullet";
  public readonly cooldown = 1000;
  public readonly critMultiplier = 1;
  public readonly boxPrice = 0;
  public readonly cost = 40_000;
  public readonly chainPosition = { x: 370, y: 32 };

  public readonly stats: Stats = {
    fortitude: 3,
    prudence: 3,
    temperance: 3,
    justice: 3,
  };

  // This weapon hit gives no boxes, but on critical hit,
  // spawns a circle that fires a bullet,
  // which hits glupo and gives 1-7 boxes that have following price:
  private readonly bonusPerBox = 777;
  private bulletsFired: number = 0;

  public onHit(store: GlupoStore, { isCritical }: HitParams) {
    if (!isCritical) {
      return;
    }

    const centerX = store.game.glupo.data.x;
    const centerY = store.game.glupo.data.y;

    const radius = 200;
    const angle = Math.random() * Math.PI * 2;
    const circleX = centerX + Math.cos(angle) * radius;
    const circleY = centerY + Math.sin(angle) * radius;

    const isSeventh = (this.bulletsFired + 1) % 7 === 0;

    const targetX = isSeventh ? store.game.mouse.x : centerX;
    const targetY = isSeventh ? store.game.mouse.y : centerY;
    const dirLen = Math.hypot(targetX - circleX, targetY - circleY) || 1;
    const dirX = (targetX - circleX) / dirLen;
    const dirY = (targetY - circleY) / dirLen;
    const epsilon = 0.001;

    store.game.particles.addParticle({
      x: circleX,
      y: circleY,
      vx: dirX * epsilon,
      vy: dirY * epsilon,
      size: 96,
      opacity: 1,
      opacityDecay: 0,
      rotation: 0,
      hue: 0,
      asset: isSeventh
        ? "ui.magic-bullet-circle-7th"
        : "ui.magic-bullet-circle",
      timeLeft: isSeventh ? 500 + Math.random() * 250 : 750,
      gravity: 0,
      onDestroy: () => {
        this.fireBulletFrom(store, { x: circleX, y: circleY });
      },
    });
  }

  private fireBulletFrom(store: GlupoStore, from: { x: number; y: number }) {
    const isSeventh = (this.bulletsFired + 1) % 7 === 0;

    const target = isSeventh
      ? { x: store.game.mouse.x, y: store.game.mouse.y }
      : { x: store.game.glupo.data.x, y: store.game.glupo.data.y };

    const dx = target.x - from.x;
    const dy = target.y - from.y;

    const travelMs = 250;
    const approximateFrames = travelMs / 16.67;
    const vx = dx / approximateFrames;
    const vy = dy / approximateFrames;

    store.game.particles.addParticle({
      x: from.x,
      y: from.y,
      vx,
      vy,
      size: 48,
      opacity: 1,
      opacityDecay: 0,
      rotation: 0,
      hue: 0,
      asset: isSeventh ? "ui.magic-bullet-shot-7th" : "ui.magic-bullet-shot",
      timeLeft: isSeventh ? 5000 : travelMs,
      gravity: 0,
      destroyCondition: isSeventh ? "player-hit" : "glupo-hit",
      onDestroy: (particle, reason) => {
        if (isSeventh) {
          if (reason === "player-hit") {
            const current = store.game.sanityState.current;
            if (current > 0) {
              store.game.changeSanity(-current);
            }
          }
        } else {
          if (reason === "glupo-hit" || reason === "default") {
            const stats = store.stats!;
            const boxCount = randomRangeInt(stats.minBoxes, stats.maxBoxes);
            const bonus = boxCount * this.bonusPerBox;
            store.addBalance(bonus);

            store.game.spawnBoxes(
              {
                x: particle.x,
                y: particle.y,
              },
              randomRangeInt(1, 7),
              {
                size: 48,
                asset: "ui.box-white",
              }
            );
          }
        }
      },
    });

    this.bulletsFired += 1;
  }
}
