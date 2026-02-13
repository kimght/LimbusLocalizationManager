import { GlupoStore } from "./store";
import { ImageAssetId } from "./assets";

export const RiskLevel = {
  Zayin: "zayin",
  Teth: "teth",
  He: "he",
  Waw: "waw",
  Aleph: "aleph",
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export interface Stats {
  fortitude: number;
  prudence: number;
  temperance: number;
  justice: number;
}

export interface HitParams {
  isCritical: boolean;
  position: { x: number; y: number };
}

export interface Weapon {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stats: Stats;
  readonly image: ImageAssetId;
  readonly cooldown: number;
  readonly critMultiplier: number;
  readonly boxPrice: number;
  readonly cost: number;
  readonly chainPosition: { x: number; y: number };

  onHit?(game: GlupoStore, params: HitParams): void;
  onPanic?(game: GlupoStore): void;
  onPanicEnd?(game: GlupoStore): void;
}

export interface Armor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stats: Stats;
  readonly image: ImageAssetId;
  readonly cost: number;

  onHit?(game: GlupoStore, params: HitParams): void;
  onPanic?(game: GlupoStore): void;
  onPanicEnd?(game: GlupoStore): void;
}
