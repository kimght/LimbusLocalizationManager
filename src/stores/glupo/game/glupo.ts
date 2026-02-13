import { Drawable, DrawProps } from "./types";
import { Game } from "./game";

export type GlupoData = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  rotationVelocity: number;
  rotationDamping: number;
};

export class Glupo implements Drawable {
  public data: GlupoData = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    rotationVelocity: 0,
    rotationDamping: 0.95,
  };

  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  public draw(props: DrawProps) {
    const { ctx, canvas, assets } = props;

    ctx.save();

    let glupo = assets["glupo.idle"].img;
    const { maxSanity } = this.game.store.stats!;

    if (this.game.sanityState.current < maxSanity * 0.5) {
      glupo = assets["glupo.hurt"].img;
    }

    const glupoWidth = glupo.width;
    const glupoHeight = glupo.height;
    const glupoScale = 0.15;

    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.beginPath();

    ctx.translate(canvas.width / 2, canvas.height / 2);

    const maxRotation = (10 * Math.PI) / 180;

    ctx.ellipse(
      0,
      (glupoHeight * glupoScale) / 2 - 20,
      (glupoWidth * glupoScale) / 2 +
        Math.abs(this.data.rotation / maxRotation) * 5,
      (glupoHeight * glupoScale) / 6,
      0,
      0,
      Math.PI * 2
    );

    ctx.fill();

    this.data.rotation += this.data.rotationVelocity;
    this.data.rotationVelocity *= this.data.rotationDamping;
    this.data.rotationVelocity -= this.data.rotation * 0.01;

    if (this.data.rotation > maxRotation) {
      this.data.rotation = maxRotation;
      this.data.rotationVelocity = -Math.abs(this.data.rotationVelocity) * 0.5;
    } else if (this.data.rotation < -maxRotation) {
      this.data.rotation = -maxRotation;
      this.data.rotationVelocity = Math.abs(this.data.rotationVelocity) * 0.5;
    }

    ctx.rotate(this.data.rotation);

    ctx.drawImage(
      glupo,
      (-glupoWidth * glupoScale) / 2,
      (-glupoHeight * glupoScale) / 2,
      glupoWidth * glupoScale,
      glupoHeight * glupoScale
    );

    this.data = {
      ...this.data,
      x: canvas.width / 2,
      y: canvas.height * 0.4,
      width: 150,
      height: 200,
    };

    ctx.restore();
  }

  public addVelocity(rv: number) {
    this.data.rotationVelocity += rv;
  }
}
