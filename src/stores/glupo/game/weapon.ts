import { Drawable, DrawProps } from "./types";
import { Game } from "./game";
import { trinkets } from "../trinket";

export type WeaponData = {
  x: number;
  y: number;
  speed: number;
  angle: number;
  visible: boolean;

  chain: {
    points: TrinketChainPoint[];
    segments: TrinketChainSegment[];
  } | null;
};

function applySourceTransform(
  imageParams: {
    w: number;
    h: number;
    scale: number;
  },
  point: {
    x: number;
    y: number;
  },
  origin: {
    x: number;
    y: number;
    angle: number;
  }
) {
  const xScaled = point.x * imageParams.scale;
  const yScaled = point.y * imageParams.scale;

  const xCentered = xScaled - (imageParams.w * imageParams.scale) / 2;
  const yCentered = yScaled - (imageParams.h * imageParams.scale) / 2;

  const rotationAngle = Math.PI / 2 - origin.angle;
  const cos = Math.cos(rotationAngle);
  const sin = Math.sin(rotationAngle);

  const xRotated = xCentered * cos - yCentered * sin;
  const yRotated = xCentered * sin + yCentered * cos;

  return { x: xRotated + origin.x, y: yRotated + origin.y };
}

const chainParams = {
  friction: 0.99,
  gravity: { x: 0, y: 0.5 },
  stiffness: 5,
  segmentLength: 10,
  segmentCount: 10,
} as const;

class TrinketChainPoint {
  public pos: { x: number; y: number };
  public oldPos: { x: number; y: number };
  public readonly isStatic: boolean;
  public readonly mass: number;
  public readonly invMass: number;

  constructor(
    pos: { x: number; y: number },
    isStatic: boolean,
    mass: number = 1
  ) {
    this.pos = { ...pos };
    this.oldPos = { ...pos };
    this.isStatic = isStatic;

    this.mass = isStatic ? Infinity : mass;
    this.invMass = 1 / this.mass;
  }

  public update() {
    const { friction, gravity } = chainParams;

    const velX = (this.pos.x - this.oldPos.x) * friction;
    const velY = (this.pos.y - this.oldPos.y) * friction;

    this.oldPos.x = this.pos.x;
    this.oldPos.y = this.pos.y;

    this.pos.x += velX + gravity.x;
    this.pos.y += velY + gravity.y;
  }

  public setPosition(x: number, y: number) {
    this.oldPos.x = this.pos.x;
    this.oldPos.y = this.pos.y;

    this.pos.x = x;
    this.pos.y = y;
  }
}

class TrinketChainSegment {
  public readonly p1: TrinketChainPoint;
  public readonly p2: TrinketChainPoint;
  public readonly length: number;

  constructor(p1: TrinketChainPoint, p2: TrinketChainPoint, length: number) {
    this.p1 = p1;
    this.p2 = p2;
    this.length = length;
  }

  public update() {
    const dx = this.p2.pos.x - this.p1.pos.x;
    const dy = this.p2.pos.y - this.p1.pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return;

    const difference = this.length - distance;
    const percent = difference / distance / (this.p1.invMass + this.p2.invMass);
    const offsetX = dx * percent;
    const offsetY = dy * percent;

    this.p1.pos.x -= offsetX * this.p1.invMass;
    this.p1.pos.y -= offsetY * this.p1.invMass;
    this.p2.pos.x += offsetX * this.p2.invMass;
    this.p2.pos.y += offsetY * this.p2.invMass;
  }

  public draw(props: DrawProps, color?: string) {
    const { ctx } = props;

    ctx.beginPath();
    ctx.moveTo(this.p1.pos.x, this.p1.pos.y);
    ctx.lineTo(this.p2.pos.x, this.p2.pos.y);
    ctx.strokeStyle = color ?? "#773f1c";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();
  }
}

export class Weapon implements Drawable {
  public data: WeaponData = {
    x: 0,
    y: 0,
    speed: 0,
    angle: 0,
    visible: false,
    chain: null,
  };

  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  public draw(props: DrawProps) {
    const { ctx, canvas, assets } = props;

    if (!this.data.visible) {
      return;
    }

    const weapon = assets[this.game.store.selectedWeapon!.image].img;
    const weaponWidth = weapon.width;
    const weaponHeight = weapon.height;
    const weaponScale = 0.5;

    let x = this.data.x;
    let y = this.data.y;

    if (this.game.sanityState.isPanic) {
      x += 3 - Math.random() * 6;
      y += 3 - Math.random() * 6;
    }

    const deltaAngle =
      Math.tanh(this.data.speed / (canvas.width * 0.05)) *
      ((15 * Math.PI) / 180);

    this.data.angle = deltaAngle;

    const { chainPosition } = this.game.store.selectedWeapon!;

    const { x: chainOriginX, y: chainOriginY } = applySourceTransform(
      { w: weaponWidth, h: weaponHeight, scale: weaponScale },
      chainPosition,
      { x, y, angle: deltaAngle }
    );

    this.drawTrinket(props, { x: chainOriginX, y: chainOriginY });

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 2 - deltaAngle);

    ctx.drawImage(
      weapon,
      (-weaponWidth * weaponScale) / 2,
      (-weaponHeight * weaponScale) / 2,
      weaponWidth * weaponScale,
      weaponHeight * weaponScale
    );

    ctx.restore();
  }

  public setVisible(visible: boolean) {
    this.data.visible = visible;
  }

  public setPosition(x: number, y: number, speed: number) {
    this.data.x = x;
    this.data.y = y;
    this.data.speed = speed;
  }

  private setupTrinketChain(origin: { x: number; y: number }) {
    const points = [];
    const segments = [];

    for (let i = 0; i < chainParams.segmentCount; i++) {
      const isStatic = i === 0;
      const segmentMass = i === chainParams.segmentCount - 1 ? 10 : 1;
      const segmentOrigin = {
        x: origin.x,
        y: origin.y + i * chainParams.segmentLength,
      };

      points.push(new TrinketChainPoint(segmentOrigin, isStatic, segmentMass));
    }

    for (let i = 0; i < chainParams.segmentCount - 1; i++) {
      segments.push(
        new TrinketChainSegment(
          points[i],
          points[i + 1],
          chainParams.segmentLength
        )
      );
    }

    this.data.chain = {
      points,
      segments,
    };
  }

  private drawTrinket(props: DrawProps, origin: { x: number; y: number }) {
    const selectedTrinket = this.game.store.gameData!.selectedTrinket;

    if (!selectedTrinket) {
      return;
    }

    if (this.data.chain === null) {
      this.setupTrinketChain(origin);
    }

    const { points, segments } = this.data.chain!;

    points.forEach((p) => p.update());

    const firstPoint = points[0];
    firstPoint.setPosition(origin.x, origin.y);

    for (let i = 0; i < chainParams.stiffness; i++) {
      segments.forEach((s) => s.update());
    }

    segments.forEach((s) => s.draw(props, "#b36d1b"));

    const { ctx, assets } = props;
    const trinket = assets[trinkets[selectedTrinket].image].img;

    const lastPoint = points[points.length - 1];
    const lastPointPos = lastPoint.pos;
    const trinketSize = 48;

    ctx.drawImage(
      trinket,
      lastPointPos.x - trinketSize / 2,
      lastPointPos.y - trinketSize / 2,
      trinketSize,
      trinketSize
    );
  }
}
