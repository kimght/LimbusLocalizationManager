import { ImageAssetId } from "../assets";
import { Drawable, DrawProps } from "./types";

export type ParticleData = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  opacityDecay: number;
  rotation: number;
  hue: number;
  asset: ImageAssetId;
  timeLeft: number;
  gravity: number;
  destroyCondition?: "glupo-hit" | "player-hit";
  onDestroy?: (
    particle: ParticleData,
    reason?: "default" | "glupo-hit" | "player-hit"
  ) => void;
};

export class Particles implements Drawable {
  public particles: ParticleData[] = [];

  public draw(props: DrawProps) {
    const { ctx, canvas, assets, deltaTime } = props;

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];

      particle.x += particle.vx;
      particle.y += particle.vy;

      particle.vy += particle.gravity;

      particle.rotation = Math.atan2(particle.vy, particle.vx);

      // Special destroy conditions (collision checks)
      if (particle.destroyCondition) {
        const glupo = props.game.glupo.data;
        if (particle.destroyCondition === "glupo-hit") {
          const dx = particle.x - glupo.x;
          const dy = particle.y - glupo.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= Math.max(glupo.width, glupo.height) * 0.25) {
            particle.onDestroy?.(particle, "glupo-hit");
            this.particles.splice(i, 1);
            i--;
            continue;
          }
        }
        if (particle.destroyCondition === "player-hit") {
          const weapon = props.game.weapon.data;
          if (weapon.visible) {
            const weaponAssetId = props.game.store.selectedWeapon!.image;
            const weaponImg = props.assets[weaponAssetId].img;
            const weaponWidth = weaponImg.width;
            const weaponHeight = weaponImg.height;

            const drawScale = 0.5; // keep in sync with Weapon.draw
            const hitboxScale = 0.9; // 90% of sprite as requested

            const halfW = (weaponWidth * drawScale * hitboxScale) / 2;
            const halfH = (weaponHeight * drawScale * hitboxScale) / 2;

            // Angle used in Weapon.draw: Math.PI / 2 - data.angle
            const orientation = Math.PI / 2 - weapon.angle;
            const cos = Math.cos(orientation);
            const sin = Math.sin(orientation);

            const dx = particle.x - weapon.x;
            const dy = particle.y - weapon.y;

            // rotate into weapon local space (undo rotation)
            const localX = cos * dx + sin * dy;
            const localY = -sin * dx + cos * dy;

            if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
              particle.onDestroy?.(particle, "player-hit");
              this.particles.splice(i, 1);
              i--;
              continue;
            }
          }
        }
      }

      if (particle.x <= 0 || particle.x >= canvas.width - particle.size) {
        particle.vx = -particle.vx * 0.7;
        particle.x = particle.x <= 0 ? 0 : canvas.width - particle.size;
      }

      if (particle.y <= 0) {
        particle.vy = Math.abs(particle.vy) * 0.7;
        particle.y = 0;
      }

      if (particle.y >= canvas.height) {
        particle.onDestroy?.(particle);
        this.particles.splice(i, 1);
        continue;
      }

      particle.opacity -= particle.opacityDecay;
      if (particle.opacity <= 0) {
        particle.onDestroy?.(particle);
        this.particles.splice(i, 1);
        continue;
      }

      particle.timeLeft -= deltaTime;
      if (particle.timeLeft <= 0) {
        particle.onDestroy?.(particle, "default");
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = particle.opacity;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      // ctx.filter = `hue-rotate(48deg)`;
      ctx.drawImage(
        assets[particle.asset].img,
        -particle.size / 2,
        -particle.size / 2,
        particle.size,
        particle.size
      );
      ctx.restore();
    }
  }

  public addParticle(props: ParticleData) {
    this.particles.push(props);
  }
}
