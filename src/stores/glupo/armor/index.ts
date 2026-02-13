import { Penitence } from "./penitence";
import { RedEyes } from "./red-eyes";
import { Harvest } from "./harvest";
import { Heaven } from "./heaven";
import { Smile } from "./smile";
import { Twilight } from "./twilight";

export const ArmorIds = {
  Penitence: "armor.penitence",
  RedEyes: "armor.red-eyes",
  Harvest: "armor.harvest",
  Heaven: "armor.heaven",
  Smile: "armor.smile",
  Twilight: "armor.twilight",
} as const;

export type ArmorId = (typeof ArmorIds)[keyof typeof ArmorIds];

export const armor = {
  [ArmorIds.Penitence]: new Penitence(),
  [ArmorIds.RedEyes]: new RedEyes(),
  [ArmorIds.Harvest]: new Harvest(),
  [ArmorIds.Heaven]: new Heaven(),
  [ArmorIds.Smile]: new Smile(),
  [ArmorIds.Twilight]: new Twilight(),
};
