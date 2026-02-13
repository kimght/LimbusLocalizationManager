import { ArmorId, ArmorIds } from "../armor";
import { TrinketId } from "../trinket";
import { RiskLevel, Stats } from "../types";
import { WeaponId, WeaponIds } from "../weapon";
import { GameData as GameDataV1 } from "./v1";

export type GameData = {
  selectedWeapon: WeaponId;
  selectedArmor: ArmorId;
  boughtWeapons: WeaponId[];
  boughtArmor: ArmorId[];
  riskLevel: RiskLevel;
  balance: number;
  baseStats: Stats;

  loopCount: number;
  lightShards: number;
  selectedTrinket: TrinketId | null;
  boughtTrinkets: TrinketId[];

  // Settings
  isSoundEnabled: boolean;
};

export const defaultGameData: GameData = {
  selectedWeapon: WeaponIds.Penitence,
  selectedArmor: ArmorIds.Penitence,
  boughtWeapons: [WeaponIds.Penitence],
  boughtArmor: [ArmorIds.Penitence],
  riskLevel: RiskLevel.Zayin,
  balance: 0,
  baseStats: {
    fortitude: 1,
    prudence: 1,
    temperance: 1,
    justice: 1,
  },
  lightShards: 0,
  loopCount: 0,
  selectedTrinket: null,
  boughtTrinkets: [],
  isSoundEnabled: true,
} as const;

export function migrate(data: GameDataV1): GameData {
  return {
    ...data,
    lightShards: 0,
    loopCount: 0,
    selectedTrinket: null,
    boughtTrinkets: [],
    isSoundEnabled: true,
  };
}
