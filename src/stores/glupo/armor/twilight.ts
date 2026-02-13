import { ArmorIds } from ".";
import { Armor, Stats } from "../types";
import { GlupoStore } from "../store";

export class Twilight implements Armor {
  public readonly id = ArmorIds.Twilight;
  public readonly name = "glupo.armor.twilight";
  public readonly image = "armor.twilight";
  public readonly description = "glupo.armor.twilightDescription";
  public readonly cost = 1_250_000;

  public readonly stats: Stats = {
    fortitude: 10,
    prudence: 10,
    temperance: 10,
    justice: 10,
  };

  public onPanic(store: GlupoStore) {
    const random = Math.random();

    if (random < 0.5) {
      store.game.sanityState.current = store.stats!.maxSanity;
    }
  }
}
