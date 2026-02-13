import { GlupoStore } from "./glupo";

class RootStore {
  public glupo: GlupoStore;

  constructor() {
    this.glupo = new GlupoStore();
  }
}

export const rootStore = new RootStore();
