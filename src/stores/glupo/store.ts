import { autorun, makeAutoObservable, runInAction } from "mobx";
import { Armor, Weapon, Stats, HitParams, RiskLevel } from "./types";
import { loadImageAssets, soundAssets, type ImageAssets } from "./assets";
import { WeaponId, weapons } from "./weapon";
import { ArmorId, armor } from "./armor";
import { TrinketId, TrinketRarity, trinkets } from "./trinket";
import { load, type Store } from "@tauri-apps/plugin-store";
import { Game } from "./game";
import { SoundManager } from "./sound";
import {
  loadGameData,
  saveGameData,
  defaultGameData,
  type GameData,
} from "./config";
import { choose, randomRangeInt, weightedChoose } from "./utils";
import { error as logError } from "@tauri-apps/plugin-log";

export class GlupoStore {
  public gameData: GameData | null = null;

  public bonusStats: Stats = {
    fortitude: 0,
    prudence: 0,
    temperance: 0,
    justice: 0,
  };

  public isLoading: boolean = true;
  public error: string | null = null;

  public imageAssets: ImageAssets | null = null;
  public game: Game;
  public store: Store | null = null;
  public soundManager: SoundManager<typeof soundAssets> | null = null;

  constructor() {
    this.game = new Game(this);

    makeAutoObservable(
      this,
      {
        game: false,
      },
      { autoBind: true }
    );

    this.load();

    autorun(() => {
      if (
        this.store === null ||
        this.error !== null ||
        this.gameData === null
      ) {
        return;
      }

      saveGameData(this.store!, this.gameData!).catch((e) => {
        logError(`Failed to save game data: ${e}`);
      });
    });
  }

  public async load() {
    this.isLoading = true;
    this.error = null;

    try {
      await this.refresh();
    } catch (e) {
      logError(`${e}`);
      runInAction(() => {
        this.error = `Failed to load game data: ${e}`;
        logError(this.error);
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  public async refresh() {
    const assets = await loadImageAssets();
    const store = await load("glupo.json");

    const soundManager = new SoundManager(soundAssets);
    await soundManager.preload();

    const gameData = await loadGameData(store);

    runInAction(() => {
      this.imageAssets = assets;
      this.store = store;
      this.soundManager = soundManager;
      this.gameData = gameData;
      this.game.init();
    });
  }

  public get selectedWeapon() {
    return weapons[
      this.gameData?.selectedWeapon ?? defaultGameData.selectedWeapon
    ] as Weapon;
  }

  public get selectedArmor() {
    return armor[
      this.gameData?.selectedArmor ?? defaultGameData.selectedArmor
    ] as Armor;
  }

  public updateGameData(gameData: Partial<GameData>) {
    if (this.gameData === null) {
      return;
    }

    this.gameData = {
      ...this.gameData,
      ...gameData,
    };
  }

  public processHit(params: HitParams) {
    if (this.selectedArmor !== null) {
      this.selectedArmor.onHit?.(this, params);
    }

    if (this.selectedWeapon !== null) {
      this.selectedWeapon.onHit?.(this, params);
    }
  }

  public processPanic() {
    if (this.selectedArmor !== null) {
      this.selectedArmor.onPanic?.(this);
    }

    if (this.selectedWeapon !== null) {
      this.selectedWeapon.onPanic?.(this);
    }
  }

  public processPanicEnd() {
    if (this.selectedArmor !== null) {
      this.selectedArmor.onPanicEnd?.(this);
    }

    if (this.selectedWeapon !== null) {
      this.selectedWeapon.onPanicEnd?.(this);
    }
  }

  public addBalance(amount: number) {
    const { balance } = this.gameData!;

    this.updateGameData({
      balance: Math.min(balance + amount, this.maxBalance),
    });
  }

  public addBoxes(amount: number, multiplier: number = 1) {
    const boxPrice = this.stats?.boxPrice ?? 1;
    const total = Math.floor(amount * multiplier * boxPrice);
    this.addBalance(total);
  }

  public addBonusStats(stats: Partial<Stats>) {
    Object.entries(stats).forEach(([key, value]) => {
      this.bonusStats[key as keyof Stats] += value;
    });
  }

  public get maxBalance() {
    const { riskLevel } = this.gameData!;

    return this.riskBalanceLimits[riskLevel];
  }

  public get isFullBalance() {
    const { balance } = this.gameData!;
    return balance === this.maxBalance;
  }

  public get playerStats() {
    const { baseStats } = this.gameData!;

    const stats = { ...baseStats };

    if (this.selectedWeapon !== null) {
      Object.entries(this.selectedWeapon.stats).forEach(([key, value]) => {
        stats[key as keyof Stats] += value;
      });
    }

    if (this.selectedArmor !== null) {
      Object.entries(this.selectedArmor.stats).forEach(([key, value]) => {
        stats[key as keyof Stats] += value;
      });
    }

    Object.entries(this.bonusStats).forEach(([key, value]) => {
      stats[key as keyof Stats] += value;
    });

    for (const key in stats) {
      stats[key as keyof Stats] = Math.max(stats[key as keyof Stats], 0);
    }

    return stats;
  }

  public get stats() {
    const stats = this.playerStats;

    if (stats === null) {
      return null;
    }

    // Fortitude
    const minBoxes = Math.floor(stats.fortitude / 3) + 1;
    const maxBoxes = Math.floor(stats.fortitude * 1.5) + 1;

    // Prudence
    const maxSanity = 60 + stats.prudence * 20;
    const regenerationDelay = 2500 / (1 + 0.3 * stats.prudence);
    const panicRestoreDelay = 300 / (stats.prudence + 1);

    // Temperance
    let criticalChance = 0;
    for (let current = stats.temperance; current > 0; current--) {
      let step = 5;

      if (criticalChance + step > 50) {
        step /= 2;
      }

      if (criticalChance + step > 75) {
        step /= 2;
      }

      if (criticalChance + step > 90) {
        step /= 2;
      }

      if (criticalChance + step > 95) {
        criticalChance = 95;
        break;
      }

      criticalChance += step;
    }

    criticalChance = criticalChance / 100;
    const criticalMultiplier = this.selectedWeapon?.critMultiplier ?? 2;

    // Justice
    const cooldownModifier = 1 + stats.justice * 0.1;
    const cooldown = this.selectedWeapon?.cooldown ?? 250;
    const realCooldown = cooldown / cooldownModifier;

    // Extra
    const boxPrice = this.selectedWeapon?.boxPrice ?? 1;

    return {
      // Fortitude
      minBoxes,
      maxBoxes,

      // Prudence
      maxSanity,
      regenerationDelay,
      panicRestoreDelay,

      // Temperance
      criticalChance,
      criticalMultiplier,

      // Justice
      cooldownModifier,
      cooldown,
      realCooldown,

      // Extra
      boxPrice,
    };
  }

  public get statsLevelsCost() {
    return [
      0, 100, 300, 1_500, 10_000, 30_000, 100_000, 250_000, 1_000_000,
      2_500_000,
    ];
  }

  public get maxStats() {
    return {
      fortitude: this.statsLevelsCost.length,
      prudence: this.statsLevelsCost.length,
      temperance: this.statsLevelsCost.length,
      justice: this.statsLevelsCost.length,
    };
  }

  public get statsUpgradeCost() {
    const baseStats = this.gameData!.baseStats;

    return {
      fortitude: this.statsLevelsCost[baseStats.fortitude] ?? null,
      prudence: this.statsLevelsCost[baseStats.prudence] ?? null,
      temperance: this.statsLevelsCost[baseStats.temperance] ?? null,
      justice: this.statsLevelsCost[baseStats.justice] ?? null,
    };
  }

  public get canUpgradeStats() {
    const upgradeCosts = this.statsUpgradeCost;
    const { balance } = this.gameData!;

    return {
      fortitude:
        upgradeCosts.fortitude !== null && balance >= upgradeCosts.fortitude,
      prudence:
        upgradeCosts.prudence !== null && balance >= upgradeCosts.prudence,
      temperance:
        upgradeCosts.temperance !== null && balance >= upgradeCosts.temperance,
      justice: upgradeCosts.justice !== null && balance >= upgradeCosts.justice,
    };
  }

  public upgradeStats(stat: keyof Stats) {
    const upgradeCosts = this.statsUpgradeCost;
    const { baseStats, balance } = this.gameData!;

    if (upgradeCosts[stat] === null) {
      return;
    }

    if (balance < upgradeCosts[stat]) {
      return;
    }

    this.updateGameData({
      balance: balance - upgradeCosts[stat],
      baseStats: {
        ...baseStats,
        [stat]: baseStats[stat] + 1,
      },
    });
  }

  public get riskBalanceLimits() {
    return {
      [RiskLevel.Zayin]: 500,
      [RiskLevel.Teth]: 7_500,
      [RiskLevel.He]: 75_000,
      [RiskLevel.Waw]: 750_000,
      [RiskLevel.Aleph]: Infinity,
    };
  }

  public get riskUpgradeCost() {
    const { riskLevel } = this.gameData!;

    return {
      [RiskLevel.Zayin]: 500,
      [RiskLevel.Teth]: 7_500,
      [RiskLevel.He]: 75_000,
      [RiskLevel.Waw]: 750_000,
      [RiskLevel.Aleph]: null,
    }[riskLevel];
  }

  public get canUpgradeRisk() {
    const { balance } = this.gameData!;

    return this.riskUpgradeCost !== null && balance >= this.riskUpgradeCost;
  }

  public get nextRiskLevel() {
    const { riskLevel } = this.gameData!;

    return {
      [RiskLevel.Zayin]: RiskLevel.Teth,
      [RiskLevel.Teth]: RiskLevel.He,
      [RiskLevel.He]: RiskLevel.Waw,
      [RiskLevel.Waw]: RiskLevel.Aleph,
      [RiskLevel.Aleph]: null,
    }[riskLevel];
  }

  public upgradeRisk() {
    const { riskLevel, balance } = this.gameData!;

    if (riskLevel === null || this.riskUpgradeCost === null) {
      return;
    }

    if (balance < this.riskUpgradeCost) {
      return;
    }

    this.updateGameData({
      balance: balance - this.riskUpgradeCost,
      riskLevel: this.nextRiskLevel!,
    });
  }

  public get weaponsShop() {
    const { boughtWeapons } = this.gameData!;

    const orderedWeapons = Object.values(weapons).sort(
      (a, b) => a.cost - b.cost
    );

    return orderedWeapons.map((weapon) => ({
      ...weapon,
      isBought: boughtWeapons.includes(weapon.id),
      isSelected: this.selectedWeapon?.id === weapon.id,
    }));
  }

  public get armorShop() {
    const { boughtArmor } = this.gameData!;

    const orderedArmor = Object.values(armor).sort((a, b) => a.cost - b.cost);

    return orderedArmor.map((armor) => ({
      ...armor,
      isBought: boughtArmor.includes(armor.id),
      isSelected: this.selectedArmor?.id === armor.id,
    }));
  }

  public selectWeapon(weaponId: WeaponId) {
    const { boughtWeapons } = this.gameData!;

    if (boughtWeapons.includes(weaponId)) {
      this.updateGameData({
        selectedWeapon: weaponId,
      });
    }
  }

  public buyWeapon(weaponId: WeaponId) {
    const { boughtWeapons, balance } = this.gameData!;

    if (boughtWeapons.includes(weaponId)) {
      return;
    }

    if (balance < weapons[weaponId].cost) {
      return;
    }

    this.updateGameData({
      balance: balance - weapons[weaponId].cost,
      boughtWeapons: [...boughtWeapons, weaponId],
      selectedWeapon: weaponId,
    });
  }

  public selectArmor(armorId: ArmorId) {
    const { boughtArmor } = this.gameData!;

    if (boughtArmor.includes(armorId)) {
      this.updateGameData({
        selectedArmor: armorId,
      });
    }
  }

  public buyArmor(armorId: ArmorId) {
    const { boughtArmor, balance } = this.gameData!;

    if (boughtArmor.includes(armorId)) {
      return;
    }

    if (balance < armor[armorId].cost) {
      return;
    }

    this.updateGameData({
      balance: balance - armor[armorId].cost,
      boughtArmor: [...boughtArmor, armorId],
      selectedArmor: armorId,
    });
  }

  public get isDev() {
    return import.meta.env.DEV;
  }

  public cheat() {
    if (!this.isDev) {
      return;
    }

    const { balance } = this.gameData!;

    this.updateGameData({
      balance: isFinite(this.maxBalance)
        ? this.maxBalance
        : balance + 1_000_000,
      lightShards: 90,
    });
  }

  public resetTrinkets() {
    if (!this.isDev) {
      return;
    }

    this.updateGameData({ boughtTrinkets: [], selectedTrinket: null });
  }

  public get resetCost() {
    return 25_000_000;
  }

  public buyReset() {
    const { balance } = this.gameData!;

    if (balance < this.resetCost) {
      return;
    }

    // Metaprogression
    const {
      lightShards,
      boughtTrinkets,
      selectedTrinket,
      loopCount,
      isSoundEnabled,
    } = this.gameData!;

    this.gameData = {
      ...defaultGameData,

      lightShards: lightShards + Math.floor(Math.random() * 5 + 1) * 3,
      boughtTrinkets,
      selectedTrinket,
      loopCount: loopCount + 1,

      // Settings
      isSoundEnabled,
    };
  }

  public get trinketRollCost() {
    return 3;
  }

  public get trinketProbabilities() {
    return {
      [TrinketRarity.Common]: 0.5,
      [TrinketRarity.Rare]: 0.3,
      [TrinketRarity.Special]: 0.2,
    };
  }

  public get trinketsByRarity() {
    const byRarity = {
      [TrinketRarity.Common]: [] as TrinketId[],
      [TrinketRarity.Rare]: [] as TrinketId[],
      [TrinketRarity.Special]: [] as TrinketId[],
    } as Record<TrinketRarity, TrinketId[]>;

    for (const [id, trinket] of Object.entries(trinkets)) {
      byRarity[trinket.rarity as TrinketRarity].push(id as TrinketId);
    }

    for (const rarity in byRarity) {
      byRarity[rarity as TrinketRarity].sort((a, b) => a.localeCompare(b));
    }

    return byRarity;
  }

  public createTrinketReel(
    samplesCount: number = 100,
    repeatsCount: number = 3
  ) {
    const probabilities = this.trinketProbabilities;
    const byRarity = this.trinketsByRarity;
    const rarities = Object.keys(probabilities) as TrinketRarity[];

    const samples = Array.from({ length: samplesCount }, () =>
      weightedChoose(
        rarities,
        (rarity) => probabilities[rarity as TrinketRarity]
      )
    ).map((rarity) => choose(byRarity[rarity as TrinketRarity]));

    const reel: TrinketId[] = [];
    for (let i = 0; i < repeatsCount; i++) {
      reel.push(...samples);
    }

    return reel;
  }

  public get canBuyTrinketRoll() {
    const { lightShards } = this.gameData!;
    return lightShards >= this.trinketRollCost;
  }

  public buyTrinketRoll() {
    const { lightShards, boughtTrinkets } = this.gameData!;

    if (!this.canBuyTrinketRoll) {
      return;
    }

    const reel = this.createTrinketReel();
    const reelCenterStart = reel.length / 4;
    const reelCenterEnd = (reel.length * 3) / 4;
    const winnerIndex = randomRangeInt(reelCenterStart, reelCenterEnd);
    const winner = reel[winnerIndex];

    this.updateGameData({
      lightShards: lightShards - this.trinketRollCost,
      boughtTrinkets: boughtTrinkets.includes(winner)
        ? boughtTrinkets
        : [...boughtTrinkets, winner],
    });

    return {
      reel,
      winner,
      winnerIndex,
    };
  }

  public get trinketList() {
    const { boughtTrinkets } = this.gameData!;

    const byRarity = this.trinketsByRarity;
    const trinketList = {} as Record<
      TrinketRarity,
      { id: TrinketId; image: string; isBought: boolean }[]
    >;

    for (const rarity in byRarity) {
      trinketList[rarity as TrinketRarity] = byRarity[
        rarity as TrinketRarity
      ].map((id) => ({
        image: this.imageAssets![trinkets[id].image].src,
        isBought: boughtTrinkets.includes(id),
        id,
      }));
    }

    return trinketList;
  }

  public selectTrinket(trinketId: TrinketId) {
    const { boughtTrinkets, selectedTrinket } = this.gameData!;

    if (!boughtTrinkets.includes(trinketId)) {
      return;
    }

    if (selectedTrinket === trinketId) {
      this.updateGameData({
        selectedTrinket: null,
      });
    } else {
      this.updateGameData({
        selectedTrinket: trinketId,
      });
    }
  }
}
