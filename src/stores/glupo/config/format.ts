import { GameData as GameDataV1 } from "./v1";
import {
  GameData as GameDataV2,
  migrate as migrateFrom1To2,
  defaultGameData as defaultGameDataV2,
} from "./v2";

export const defaultGameData = defaultGameDataV2;
export const supportedVersions = [1, 2] as const;
export const formatVersion = 2;

export type GameData = GameDataV2;

export type SupportedGameData =
  | {
      configVersion: 1;
      gameData: GameDataV1;
    }
  | {
      configVersion: 2;
      gameData: GameDataV2;
    };

type GameDataForVersion<T extends (typeof supportedVersions)[number]> = Extract<
  SupportedGameData,
  { configVersion: T }
>["gameData"];
type GameDataMigrations = {
  [K in Exclude<(typeof supportedVersions)[number], typeof formatVersion>]: (
    gameData: GameDataForVersion<K>
  ) => GameDataForVersion<typeof formatVersion>;
};

const gameDataMigrations: GameDataMigrations = {
  1: migrateFrom1To2,
} as const;

export function migrate(data: SupportedGameData): GameData {
  if (!supportedVersions.includes(data.configVersion)) {
    return defaultGameData;
  }

  if (data.configVersion === formatVersion) {
    return data.gameData;
  }

  const migration = gameDataMigrations[data.configVersion];

  return migrate({
    configVersion: formatVersion,
    gameData: migration(data.gameData),
  });
}
