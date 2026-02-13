import { ArmorIds } from ".";
import { Armor, Stats } from "../types";

export class Harvest implements Armor {
  public readonly id = ArmorIds.Harvest;
  public readonly name = "glupo.armor.harvest";
  public readonly image = "armor.harvest";
  public readonly description = "glupo.armor.harvestDescription";
  public readonly cost = 3_000;

  public readonly stats: Stats = {
    fortitude: 5,
    // Sets prudence to 0 (to be used in pair with Harvest weapon)
    prudence: -999,
    temperance: 5,
    justice: 0,
  };
}
