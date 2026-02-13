import { error as logError } from "@tauri-apps/plugin-log";

import WeaponPenitence from "@/assets/icons/glupo/weapons/penitence.webp";
import WeaponRedEyes from "@/assets/icons/glupo/weapons/red-eyes.webp";
import WeaponHarvest from "@/assets/icons/glupo/weapons/harvest.webp";
import WeaponHeaven from "@/assets/icons/glupo/weapons/heaven.webp";
import WeaponGoldRush from "@/assets/icons/glupo/weapons/gold-rush.webp";
import WeaponSmile from "@/assets/icons/glupo/weapons/smile.webp";
import WeaponTwilight from "@/assets/icons/glupo/weapons/twilight.webp";
import WeaponMagicBullet from "@/assets/icons/glupo/weapons/magic-bullet.webp";

import ArmorPenitence from "@/assets/icons/glupo/armor/penitence.webp";
import ArmorRedEyes from "@/assets/icons/glupo/armor/red-eyes.webp";
import ArmorHarvest from "@/assets/icons/glupo/armor/harvest.webp";
import ArmorHeaven from "@/assets/icons/glupo/armor/heaven.webp";
import ArmorSmile from "@/assets/icons/glupo/armor/smile.webp";
import ArmorTwilight from "@/assets/icons/glupo/armor/twilight.webp";
import ArmorMagicBullet from "@/assets/icons/glupo/armor/magic-bullet.webp";

import GlupoIdle from "@/assets/icons/glupo/glupo/idle.webp";
import GlupoHurt from "@/assets/icons/glupo/glupo/hurt.webp";

import UiBox from "@/assets/icons/glupo/ui/box.webp";
import UiBoxBlue from "@/assets/icons/glupo/ui/box-blue.webp";
import UiBoxRed from "@/assets/icons/glupo/ui/box-red.webp";
import UiBoxWhite from "@/assets/icons/glupo/ui/box-white.webp";

import UiBoxHarvest from "@/assets/icons/glupo/ui/box-harvest.webp";
import UiRedEyesSpider from "@/assets/icons/glupo/ui/red-eyes-spider.webp";
import UiHeavenBonus from "@/assets/icons/glupo/ui/heaven-bonus.webp";
import UiMagicBulletCircle from "@/assets/icons/glupo/ui/magic-bullet-circle.webp";
import UiMagicBulletCircle7th from "@/assets/icons/glupo/ui/magic-bullet-circle-7th.webp";
import UiMagicBulletShot from "@/assets/icons/glupo/ui/magic-bullet-shot.webp";
import UiMagicBulletShot7th from "@/assets/icons/glupo/ui/magic-bullet-shot-7th.webp";

import UiHitBasic from "@/assets/icons/glupo/ui/hit-basic.webp";
import UiHitCritical from "@/assets/icons/glupo/ui/hit-critical.webp";

import UiRiskZayin from "@/assets/icons/glupo/ui/risk-zayin.webp";
import UiRiskTeth from "@/assets/icons/glupo/ui/risk-teth.webp";
import UiRiskHe from "@/assets/icons/glupo/ui/risk-he.webp";
import UiRiskWaw from "@/assets/icons/glupo/ui/risk-waw.webp";
import UiRiskAleph from "@/assets/icons/glupo/ui/risk-aleph.webp";

import TrinketDante from "@/assets/icons/glupo/trinkets/dante.webp";
import TrinketDon from "@/assets/icons/glupo/trinkets/don.webp";
import TrinketFaust from "@/assets/icons/glupo/trinkets/faust.webp";
import TrinketGregor from "@/assets/icons/glupo/trinkets/gregor.webp";
import TrinketHeathcliff from "@/assets/icons/glupo/trinkets/heathcliff.webp";
import TrinketHongLu from "@/assets/icons/glupo/trinkets/hong-lu.webp";
import TrinketIshmael from "@/assets/icons/glupo/trinkets/ishmael.webp";
import TrinketMeursault from "@/assets/icons/glupo/trinkets/meursault.webp";
import TrinketOutis from "@/assets/icons/glupo/trinkets/outis.webp";
import TrinketRodion from "@/assets/icons/glupo/trinkets/rodion.webp";
import TrinketRyoshu from "@/assets/icons/glupo/trinkets/ryoshu.webp";
import TrinketSinclair from "@/assets/icons/glupo/trinkets/sinclair.webp";
import TrinketCathy from "@/assets/icons/glupo/trinkets/cathy.webp";
import TrinketErlking from "@/assets/icons/glupo/trinkets/erlking.webp";
import TrinketXiaojinCall from "@/assets/icons/glupo/trinkets/xiaojin-call.webp";
import TrinketCopiumElder from "@/assets/icons/glupo/trinkets/copium-elder.webp";
import TrinketFaustDerp from "@/assets/icons/glupo/trinkets/faust-derp.webp";
import TrinketIshmaelSad from "@/assets/icons/glupo/trinkets/ishmael-sad.webp";
import TrinketAyin from "@/assets/icons/glupo/trinkets/ayin.webp";

import GlupoIdleSound from "@/assets/audio/glupo/glupo.idle.mp3";
import GlupoHurt1Sound from "@/assets/audio/glupo/glupo.hurt-1.mp3";
import GlupoHurt2Sound from "@/assets/audio/glupo/glupo.hurt-2.mp3";
import WeaponHit1Sound from "@/assets/audio/glupo/weapon.hit-1.mp3";
import WeaponHit2Sound from "@/assets/audio/glupo/weapon.hit-2.mp3";
import WeaponHit3Sound from "@/assets/audio/glupo/weapon.hit-3.mp3";
import WeaponCrit1Sound from "@/assets/audio/glupo/weapon.crit-1.mp3";
import BoxPickupSound from "@/assets/audio/glupo/box.pickup.mp3";
import GachaTick1Sound from "@/assets/audio/glupo/gacha.tick-1.mp3";
import GachaTick2Sound from "@/assets/audio/glupo/gacha.tick-2.mp3";
import GachaFanfareSound from "@/assets/audio/glupo/gacha.fanfare.mp3";

const imageAssets = {
  // Weapons
  "weapon.penitence": WeaponPenitence,
  "weapon.red-eyes": WeaponRedEyes,
  "weapon.harvest": WeaponHarvest,
  "weapon.heaven": WeaponHeaven,
  "weapon.gold-rush": WeaponGoldRush,
  "weapon.smile": WeaponSmile,
  "weapon.twilight": WeaponTwilight,
  "weapon.magic-bullet": WeaponMagicBullet,

  // Armor
  "armor.penitence": ArmorPenitence,
  "armor.red-eyes": ArmorRedEyes,
  "armor.harvest": ArmorHarvest,
  "armor.heaven": ArmorHeaven,
  "armor.smile": ArmorSmile,
  "armor.twilight": ArmorTwilight,
  "armor.magic-bullet": ArmorMagicBullet,

  // Glupo
  "glupo.idle": GlupoIdle,
  "glupo.hurt": GlupoHurt,

  // UI
  "ui.box": UiBox,
  "ui.box-blue": UiBoxBlue,
  "ui.box-red": UiBoxRed,
  "ui.box-white": UiBoxWhite,

  // Extra particles
  "ui.box-harvest": UiBoxHarvest,
  "ui.red-eyes-spider": UiRedEyesSpider,
  "ui.heaven-bonus": UiHeavenBonus,
  "ui.magic-bullet-circle": UiMagicBulletCircle,
  "ui.magic-bullet-shot": UiMagicBulletShot,
  "ui.magic-bullet-circle-7th": UiMagicBulletCircle7th,
  "ui.magic-bullet-shot-7th": UiMagicBulletShot7th,

  "ui.hit-basic": UiHitBasic,
  "ui.hit-critical": UiHitCritical,

  "ui.risk.zayin": UiRiskZayin,
  "ui.risk.teth": UiRiskTeth,
  "ui.risk.he": UiRiskHe,
  "ui.risk.waw": UiRiskWaw,
  "ui.risk.aleph": UiRiskAleph,

  // Trinkets
  "trinket.dante": TrinketDante,
  "trinket.don": TrinketDon,
  "trinket.faust": TrinketFaust,
  "trinket.gregor": TrinketGregor,
  "trinket.heathcliff": TrinketHeathcliff,
  "trinket.hong-lu": TrinketHongLu,
  "trinket.ishmael": TrinketIshmael,
  "trinket.meursault": TrinketMeursault,
  "trinket.outis": TrinketOutis,
  "trinket.rodion": TrinketRodion,
  "trinket.ryoshu": TrinketRyoshu,
  "trinket.sinclair": TrinketSinclair,
  "trinket.cathy": TrinketCathy,
  "trinket.erlking": TrinketErlking,
  "trinket.xiaojin-call": TrinketXiaojinCall,
  "trinket.copium-elder": TrinketCopiumElder,
  "trinket.ayin": TrinketAyin,
  "trinket.faust-derp": TrinketFaustDerp,
  "trinket.ishmael-sad": TrinketIshmaelSad,
} as const;

export type ImageAssetId = keyof typeof imageAssets;
export type ImageAssets = Record<
  ImageAssetId,
  { src: string; img: HTMLImageElement }
>;

export const soundAssets = {
  "glupo.idle": GlupoIdleSound,
  "glupo.hurt-1": GlupoHurt1Sound,
  "glupo.hurt-2": GlupoHurt2Sound,
  "weapon.hit-1": WeaponHit1Sound,
  "weapon.hit-2": WeaponHit2Sound,
  "weapon.hit-3": WeaponHit3Sound,
  "weapon.crit-1": WeaponCrit1Sound,
  "box.pickup": BoxPickupSound,
  "gacha.tick-1": GachaTick1Sound,
  "gacha.tick-2": GachaTick2Sound,
  "gacha.fanfare": GachaFanfareSound,
} as const;

export type SoundAssetId = keyof typeof soundAssets;

export const loadImageAssets = async (): Promise<ImageAssets> => {
  const assets = await Promise.all(
    Object.entries(imageAssets).map(async ([key, value]) => {
      const image = new Image();

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => {
          logError(`Failed to load image: ${value}`);
          reject(new Error(`Failed to load image: ${value}`));
        };
        image.src = value;
      });

      return [key, { src: value, img: image }];
    })
  );

  return Object.fromEntries(assets) as ImageAssets;
};
