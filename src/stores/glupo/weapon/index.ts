import { Penitence } from "./penitence";
import { RedEyes } from "./red-eyes";
import { Harvest } from "./harvest";
import { Heaven } from "./heaven";
import { GoldRush } from "./gold-rush";
import { Smile } from "./smile";
import { Twilight } from "./twilight";
import { MagicBullet } from "./magic-bullet";

export const WeaponIds = {
  Penitence: "weapon.penitence",
  RedEyes: "weapon.red-eyes",
  Harvest: "weapon.harvest",
  Heaven: "weapon.heaven",
  GoldRush: "weapon.gold-rush",
  Smile: "weapon.smile",
  Twilight: "weapon.twilight",
  MagicBullet: "weapon.magic-bullet",
} as const;

export type WeaponId = (typeof WeaponIds)[keyof typeof WeaponIds];

export const weapons = {
  [WeaponIds.Penitence]: new Penitence(),
  [WeaponIds.RedEyes]: new RedEyes(),
  [WeaponIds.Harvest]: new Harvest(),
  [WeaponIds.Heaven]: new Heaven(),
  [WeaponIds.GoldRush]: new GoldRush(),
  [WeaponIds.Smile]: new Smile(),
  [WeaponIds.Twilight]: new Twilight(),
  [WeaponIds.MagicBullet]: new MagicBullet(),
};
