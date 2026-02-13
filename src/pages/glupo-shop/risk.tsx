import { rootStore } from "@/stores";
import styles from "./risk.module.css";
import { observer } from "mobx-react-lite";
import { RiskLevel } from "@/stores/glupo/types";

import Zayin from "@/assets/icons/glupo/ui/risk-zayin.webp";
import Teth from "@/assets/icons/glupo/ui/risk-teth.webp";
import He from "@/assets/icons/glupo/ui/risk-he.webp";
import Waw from "@/assets/icons/glupo/ui/risk-waw.webp";
import Aleph from "@/assets/icons/glupo/ui/risk-aleph.webp";
import Enkephalin from "@/assets/icons/glupo/ui/enkephalin.webp";
import { ArrowRight } from "lucide-react";
import { formatEnkephalin } from "@/utils";

const RiskLevelIcons = {
  [RiskLevel.Zayin]: Zayin,
  [RiskLevel.Teth]: Teth,
  [RiskLevel.He]: He,
  [RiskLevel.Waw]: Waw,
  [RiskLevel.Aleph]: Aleph,
} as const;

function Risk() {
  const { glupo } = rootStore;
  const { riskLevel } = glupo.gameData!;

  const nextRiskLevel = glupo.nextRiskLevel;

  return (
    <button
      onClick={() => glupo.upgradeRisk()}
      className={styles.container}
      disabled={!nextRiskLevel || !glupo.canUpgradeRisk}
    >
      <img
        src={RiskLevelIcons[nextRiskLevel ?? riskLevel]}
        alt={nextRiskLevel ?? riskLevel}
        className={styles.next}
      />

      {nextRiskLevel && (
        <>
          <img
            src={Enkephalin}
            alt="Enkephalin"
            className={styles.enkephalin}
          />
          <span>{glupo.maxBalance}</span>
          <ArrowRight className="w-4 h-4" />
          <img
            src={Enkephalin}
            alt="Enkephalin"
            className={styles.enkephalin}
          />
          <span>
            {isFinite(glupo.riskBalanceLimits[nextRiskLevel])
              ? glupo.riskBalanceLimits[nextRiskLevel]
              : "∞"}
          </span>
        </>
      )}

      <span className={styles.cost}>
        {formatEnkephalin(glupo.riskUpgradeCost, "max")}
      </span>
    </button>
  );
}

export default observer(Risk);
