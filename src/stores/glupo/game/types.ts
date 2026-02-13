import { ImageAssets } from "../assets";
import type { Game } from "./game";

export interface DrawProps {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  assets: ImageAssets;
  deltaTime: number;
  game: Game;
}

export interface Drawable {
  draw(props: DrawProps): void;
}
