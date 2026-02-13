import { ArmorIds } from ".";
import { GlupoStore } from "../store";
import { Armor, Stats } from "../types";

export class Penitence implements Armor {
  public readonly id = ArmorIds.Penitence;
  public readonly name = "glupo.armor.penitence";
  public readonly image = "armor.penitence";
  public readonly description = "glupo.armor.penitenceDescription";
  public readonly cost = 0;

  public readonly stats: Stats = {
    fortitude: 0,
    prudence: 3,
    temperance: 0,
    justice: 1,
  };

  public onPanic(store: GlupoStore) {
    store.game.sanityState.current = Math.min(
      store.game.sanityState.current + 20,
      store.stats!.maxSanity
    );
  }
}
