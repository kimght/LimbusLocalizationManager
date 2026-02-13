import { ArmorIds } from ".";
import { Armor, Stats } from "../types";
import { GlupoStore } from "../store";

export class Smile implements Armor {
  public readonly id = ArmorIds.Smile;
  public readonly name = "glupo.armor.smile";
  public readonly image = "armor.smile";
  public readonly description = "glupo.armor.smileDescription";
  public readonly cost = 200_000;

  public readonly stats: Stats = {
    fortitude: 6,
    prudence: 2,
    temperance: 2,
    justice: 2,
  };

  public onPanicEnd(store: GlupoStore) {
    store.addBonusStats({
      fortitude: 5,
      prudence: 0,
      temperance: 5,
      justice: 5,
    });

    setTimeout(() => {
      store.addBonusStats({
        fortitude: -5,
        prudence: 0,
        temperance: -5,
        justice: -5,
      });
    }, 5000);
  }
}
