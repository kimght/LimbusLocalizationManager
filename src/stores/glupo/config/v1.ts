import { ArmorId, ArmorIds } from "../armor";
import { RiskLevel, Stats } from "../types";
import { WeaponId, WeaponIds } from "../weapon";

export type GameData = {
  selectedWeapon: WeaponId;
  selectedArmor: ArmorId;
  boughtWeapons: WeaponId[];
  boughtArmor: ArmorId[];
  riskLevel: RiskLevel;
  balance: number;
  baseStats: Stats;
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
} as const;
