import { ArmorIds } from ".";
import { Armor, Stats } from "../types";

export class Heaven implements Armor {
  public readonly id = ArmorIds.Heaven;
  public readonly name = "glupo.armor.heaven";
  public readonly image = "armor.heaven";
  public readonly description = "glupo.armor.heavenDescription";
  public readonly cost = 6_000;

  public readonly stats: Stats = {
    fortitude: 4,
    prudence: 5,
    temperance: 6,
    justice: 3,
  };
}
