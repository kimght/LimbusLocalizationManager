import { ImageAssetId } from "./assets";

export const TrinketIds = {
  Dante: "trinket.dante",
  Don: "trinket.don",
  Faust: "trinket.faust",
  Gregor: "trinket.gregor",
  Heathcliff: "trinket.heathcliff",
  HongLu: "trinket.hong-lu",
  Ishmael: "trinket.ishmael",
  Meursault: "trinket.meursault",
  Outis: "trinket.outis",
  Rodion: "trinket.rodion",
  Ryoshu: "trinket.ryoshu",
  Sinclair: "trinket.sinclair",
  Cathy: "trinket.cathy",
  Erlking: "trinket.erlking",
  XiaojinCall: "trinket.xiaojin-call",
  CopiumElder: "trinket.copium-elder",
  Ayin: "trinket.ayin",
  FaustDerp: "trinket.faust-derp",
  IshmaelSad: "trinket.ishmael-sad",
  ArayaWatermellon: "trinket.araya-watermellon",
} as const;

export type TrinketId = (typeof TrinketIds)[keyof typeof TrinketIds];

export const TrinketRarity = {
  Common: "common",
  Rare: "rare",
  Special: "special",
} as const;

export type TrinketRarity = (typeof TrinketRarity)[keyof typeof TrinketRarity];

export type Trinket = {
  image: ImageAssetId;
  rarity: TrinketRarity;
};

export const trinkets = {
  [TrinketIds.Dante]: {
    image: "trinket.dante",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Don]: {
    image: "trinket.don",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Faust]: {
    image: "trinket.faust",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Gregor]: {
    image: "trinket.gregor",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Heathcliff]: {
    image: "trinket.heathcliff",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.HongLu]: {
    image: "trinket.hong-lu",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Ishmael]: {
    image: "trinket.ishmael",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Meursault]: {
    image: "trinket.meursault",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Outis]: {
    image: "trinket.outis",
    rarity: TrinketRarity.Rare,
  },
  [TrinketIds.Rodion]: {
    image: "trinket.rodion",
    rarity: TrinketRarity.Special,
  },
  [TrinketIds.Ryoshu]: {
    image: "trinket.ryoshu",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Sinclair]: {
    image: "trinket.sinclair",
    rarity: TrinketRarity.Common,
  },
  [TrinketIds.Cathy]: {
    image: "trinket.cathy",
    rarity: TrinketRarity.Special,
  },
  [TrinketIds.Erlking]: {
    image: "trinket.erlking",
    rarity: TrinketRarity.Special,
  },
  [TrinketIds.XiaojinCall]: {
    image: "trinket.xiaojin-call",
    rarity: TrinketRarity.Special,
  },
  [TrinketIds.CopiumElder]: {
    image: "trinket.copium-elder",
    rarity: TrinketRarity.Rare,
  },
  [TrinketIds.Ayin]: {
    image: "trinket.ayin",
    rarity: TrinketRarity.Rare,
  },
  [TrinketIds.FaustDerp]: {
    image: "trinket.faust-derp",
    rarity: TrinketRarity.Rare,
  },
  [TrinketIds.IshmaelSad]: {
    image: "trinket.ishmael-sad",
    rarity: TrinketRarity.Rare,
  },
  [TrinketIds.ArayaWatermellon]: {
    image: "trinket.araya-watermellon",
    rarity: TrinketRarity.Special,
  },
} as const satisfies Record<TrinketId, Trinket>;
