import { Game } from "./game";
import { Drawable, DrawProps } from "./types";

export type SanityGaugeData = {
  current: number;
};

export class SanityGauge implements Drawable {
  public data: SanityGaugeData = { current: 0 };
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  private updateSanity() {
    const step = (this.game.sanityState.current - this.data.current) * 0.1;

    if (Math.abs(step) < 0.1) {
      this.data.current = this.game.sanityState.current;
    } else {
      this.data.current += step;
    }
  }

  public draw(props: DrawProps) {
    const { ctx, canvas } = props;
    this.updateSanity();

    ctx.save();

    const gaugeWidth = 24 + 4;
    const gaugeHeight = canvas.height * 0.6;

    let gaugeX = canvas.width - gaugeWidth - 12;
    let gaugeY = (canvas.height - gaugeHeight) / 2;

    if (this.game.sanityState.isPanic) {
      gaugeX += 2 - Math.random() * 4;
      gaugeY += 2 - Math.random() * 4;
    }

    const { maxSanity } = this.game.store.stats!;

    const fillPercentage = this.data.current / maxSanity;
    const fillHeight = gaugeHeight * fillPercentage;

    const gradient = ctx.createLinearGradient(
      gaugeX,
      gaugeY + gaugeHeight - fillHeight,
      gaugeX,
      gaugeY + gaugeHeight
    );

    if (this.game.sanityState.isPanic) {
      gradient.addColorStop(0, "rgba(255, 102, 0, 0.95)");
      gradient.addColorStop(1, "rgba(255, 60, 0, 0.95)");
    } else {
      gradient.addColorStop(0, "rgba(76, 146, 228, 0.95)");
      gradient.addColorStop(1, "rgba(76, 124, 228, 0.95)");
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(
      gaugeX + 3,
      gaugeY + gaugeHeight - fillHeight,
      gaugeWidth - 6,
      fillHeight,
      5
    );
    ctx.fill();

    ctx.restore();
  }
}
