import { Store } from "@tauri-apps/plugin-store";
import {
  migrate,
  defaultGameData,
  formatVersion,
  type GameData,
  type SupportedGameData,
} from "./format";

export async function loadGameData(store: Store): Promise<GameData> {
  const configVersion = await store.get<number>("configVersion");
  const gameData = await store.get("gameData");

  if (!gameData) {
    await store.set("configVersion", formatVersion);
    await store.set("gameData", defaultGameData);

    return defaultGameData;
  }

  return migrate({
    configVersion,
    gameData,
  } as SupportedGameData);
}

export async function saveGameData(store: Store, gameData: GameData) {
  await store.set("configVersion", formatVersion);
  await store.set("gameData", gameData);
}

export { defaultGameData, type GameData };
