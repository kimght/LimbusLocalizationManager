import { ArmorIds } from ".";
import { Armor, Stats } from "../types";

export class RedEyes implements Armor {
  public readonly id = ArmorIds.RedEyes;
  public readonly name = "glupo.armor.redEyes";
  public readonly image = "armor.red-eyes";
  public readonly description = "glupo.armor.redEyesDescription";
  public readonly cost = 1_100;

  public readonly stats: Stats = {
    fortitude: 3,
    prudence: 1,
    temperance: 4,
    justice: 0,
  };
}
