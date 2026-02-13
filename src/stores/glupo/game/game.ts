import { GlupoStore } from "../store";
import { Glupo } from "./glupo";
import { Particles, type ParticleData } from "./particles";
import { Weapon } from "./weapon";
import { SanityGauge } from "./sanity-gauge";
import { ImageAssetId } from "../assets";
import { randomRangeInt, choose } from "../utils";

export type MouseData = {
  x: number;
  y: number;
  dx: number;
  dy: number;
};

export class Game {
  public store: GlupoStore;

  public mouse: MouseData = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
  };

  public lastTimestamp: number = 0;
  public lastHitTimestamp: number = 0;
  public nextIdleSoundTimestamp: number | null = null;

  public glupo: Glupo;
  public particles: Particles;
  public weapon: Weapon;
  public sanityGauge: SanityGauge;

  public sanityState: {
    current: number;
    isPanic: boolean;
    restoreTimer: number | null;
  } = {
    current: 100,
    isPanic: false,
    restoreTimer: null,
  };

  constructor(store: GlupoStore) {
    this.store = store;

    this.glupo = new Glupo(this);
    this.particles = new Particles();
    this.weapon = new Weapon(this);
    this.sanityGauge = new SanityGauge(this);

    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.drawFrame = this.drawFrame.bind(this);
  }

  public handleMouseMove(element: HTMLCanvasElement, event: MouseEvent) {
    const cooldown =
      this.store.stats!.cooldown / this.store.stats!.cooldownModifier;

    const rect = element.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const dx = mouseX - this.mouse.x;
    const dy = mouseY - this.mouse.y;
    const mouseSpeed = Math.sqrt(dx * dx + dy * dy);

    const distance = Math.sqrt(
      (mouseX - this.glupo.data.x) ** 2 + (mouseY - this.glupo.data.y) ** 2
    );

    if (
      distance < Math.max(this.glupo.data.width, this.glupo.data.height) / 2 &&
      mouseSpeed > 20 &&
      Date.now() - this.lastHitTimestamp > cooldown
    ) {
      this.handleHit({ x: mouseX, y: mouseY });
    }

    this.mouse.x = mouseX;
    this.mouse.y = mouseY;
    this.mouse.dx = dx;
    this.mouse.dy = dy;

    this.weapon.setPosition(mouseX, mouseY, dx);
  }

  public handleMouseEnter() {
    this.weapon.setVisible(true);
  }

  public handleMouseLeft() {
    this.weapon.setVisible(false);
  }

  public spawnBoxes(
    position: { x: number; y: number },
    count: number,
    params: Partial<ParticleData> = {}
  ) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 8 + Math.random() * 15;

      this.particles.addParticle({
        x: position.x,
        y: position.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 10,
        size: 32,
        opacity: 1,
        opacityDecay: 0.005,
        rotation: 0,
        hue: 0,
        asset: "ui.box",
        timeLeft: Infinity,
        gravity: 0.4,
        ...params,

        onDestroy: () => {
          this.store.soundManager!.play("box.pickup", {
            volume: 0.2,
          });
        },
      });
    }
  }

  public handleHit(position: { x: number; y: number }) {
    if (this.sanityState.isPanic) {
      return;
    }

    this.lastHitTimestamp = Date.now();
    const stats = this.store.stats!;

    let count = randomRangeInt(stats.minBoxes, stats.maxBoxes);

    const isCritical = Math.random() < stats.criticalChance;
    const multiplier = isCritical ? stats.criticalMultiplier : 1;

    this.store.addBoxes(count, multiplier);

    let boxesPerSecond = Math.floor(
      ((1000 / stats.realCooldown) * (stats.minBoxes + stats.maxBoxes)) / 2
    );

    let boxAsset: ImageAssetId = "ui.box";
    if (boxesPerSecond > 128) {
      boxAsset = "ui.box-white";
      count = Math.ceil(count / 4);
    } else if (boxesPerSecond > 64) {
      boxAsset = "ui.box-red";
      count = Math.ceil(count / 3);
    } else if (boxesPerSecond > 32) {
      boxAsset = "ui.box-blue";
      count = Math.ceil(count / 2);
    }

    boxesPerSecond = Math.max(100, boxesPerSecond);

    if (this.store.stats!.boxPrice > 0) {
      this.spawnBoxes(position, count, {
        size: (isCritical ? 48 : 32) + Math.log2(stats.boxPrice + 1) * 4,
        asset: boxAsset,
      });
    }

    this.particles.addParticle({
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      size: isCritical ? 64 : 24,
      opacity: 1,
      opacityDecay: 0.005,
      rotation: 0,
      hue: 0,
      asset: isCritical ? "ui.hit-critical" : "ui.hit-basic",
      timeLeft: 1000,
      gravity: 0,
    });

    this.glupo.addVelocity(Math.random() * 0.2 - 0.1);
    this.store.processHit({ isCritical, position });

    this.playHitSound(isCritical);
    this.playHurtSound();
  }

  private playHitSound(isCritical: boolean) {
    const sound = isCritical
      ? "weapon.crit-1"
      : choose(["weapon.hit-1", "weapon.hit-2", "weapon.hit-3"] as const);

    this.store.soundManager!.play(sound, {
      playbackRate: Math.random() * 0.1 + 0.95,
    });
  }

  private playHurtSound() {
    const { maxSanity } = this.store.stats!;
    const { current: currentSanity } = this.sanityState;

    const sanityPercent = currentSanity / maxSanity;

    if (sanityPercent >= 0.5) {
      return;
    }

    const chance = 0.25 + 0.5 * (1 - Math.min(1, sanityPercent / 0.5));

    if (Math.random() > chance) {
      return;
    }

    const sound = choose(["glupo.hurt-1", "glupo.hurt-2"] as const);

    this.store.soundManager!.play(sound, {
      playbackRate: Math.random() * 0.2 + 0.9,
    });
  }

  public playIdleSound() {
    const now = Date.now();

    if (now < this.lastHitTimestamp + 5000) {
      this.nextIdleSoundTimestamp = null;
      return;
    }

    if (this.nextIdleSoundTimestamp === null) {
      this.nextIdleSoundTimestamp = now + Math.random() * 5000 + 5000;
    }

    if (now < this.nextIdleSoundTimestamp) {
      return;
    }

    this.nextIdleSoundTimestamp = now + Math.random() * 5000 + 5000;
    this.store.soundManager!.play("glupo.idle", {
      playbackRate: Math.random() * 0.3 + 0.9,
    });
  }

  public changeSanity(amount: number) {
    if (this.sanityState.isPanic) {
      return;
    }

    this.sanityState.current += amount;

    const { maxSanity, panicRestoreDelay, regenerationDelay } =
      this.store.stats!;

    if (this.sanityState.current <= 0) {
      this.sanityState.current = 0;
      this.sanityState.isPanic = true;

      if (this.sanityState.restoreTimer !== null) {
        clearTimeout(this.sanityState.restoreTimer);
      }

      this.store.processPanic();

      const processPanicStep = () => {
        this.sanityState.current += 1;

        const target = this.store.stats?.maxSanity ?? maxSanity;

        if (this.sanityState.current >= target) {
          this.sanityState.isPanic = false;
          this.sanityState.restoreTimer = null;
          this.sanityState.current = target;
          this.store.processPanicEnd();
        } else {
          setTimeout(processPanicStep, this.store.stats!.panicRestoreDelay);
        }
      };

      setTimeout(processPanicStep, panicRestoreDelay);
      return;
    }

    if (this.sanityState.current > maxSanity) {
      this.sanityState.current = maxSanity;
    }

    if (this.sanityState.current === maxSanity) {
      return;
    }

    if (this.sanityState.restoreTimer !== null) {
      clearTimeout(this.sanityState.restoreTimer);
    }

    this.sanityState.restoreTimer = setTimeout(() => {
      this.sanityState.current = maxSanity;
    }, regenerationDelay);
  }

  public init() {
    this.sanityState.current = this.store.stats!.maxSanity;
    this.sanityState.isPanic = false;
    this.sanityState.restoreTimer = null;
  }

  public drawFrame(canvas: HTMLCanvasElement, timestamp: number) {
    if (this.store.isLoading) {
      return;
    }

    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
    }

    const deltaTime = timestamp - this.lastTimestamp;

    const ctx = canvas.getContext("2d");
    const assets = this.store.imageAssets!;

    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawProps = { ctx, canvas, assets, deltaTime, game: this };

    this.glupo.draw(drawProps);
    this.particles.draw(drawProps);
    this.weapon.draw(drawProps);
    this.sanityGauge.draw(drawProps);

    this.playIdleSound();

    this.lastTimestamp = timestamp;
  }
}
