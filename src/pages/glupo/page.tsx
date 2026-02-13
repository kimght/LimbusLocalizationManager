import { observer } from "mobx-react-lite";
import { rootStore } from "@/stores";
import styles from "./page.module.css";
import { useTranslation } from "react-i18next";
import { useRef, useEffect } from "react";
import { RiskLevel } from "@/stores/glupo/types";

import Enkephalin from "@/assets/icons/glupo/ui/enkephalin.webp";

import { cn, formatEnkephalin } from "@/utils";
import { NavLink } from "react-router";

import Zayin from "@/assets/icons/glupo/ui/risk-zayin.webp";
import Teth from "@/assets/icons/glupo/ui/risk-teth.webp";
import He from "@/assets/icons/glupo/ui/risk-he.webp";
import Waw from "@/assets/icons/glupo/ui/risk-waw.webp";
import Aleph from "@/assets/icons/glupo/ui/risk-aleph.webp";

const RiskLevelIcons = {
  [RiskLevel.Zayin]: Zayin,
  [RiskLevel.Teth]: Teth,
  [RiskLevel.He]: He,
  [RiskLevel.Waw]: Waw,
  [RiskLevel.Aleph]: Aleph,
} as const;

function Page() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    let animationFrame: number | null = null;

    const handleAnimationFrame = (timestamp: number) => {
      if (!canvasRef.current) {
        return;
      }

      glupo.game.drawFrame(canvasRef.current, timestamp);
      animationFrame = requestAnimationFrame(handleAnimationFrame);
    };

    animationFrame = requestAnimationFrame(handleAnimationFrame);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [glupo]);

  useEffect(() => {
    if (!canvasContainerRef.current || !canvasRef.current) {
      return;
    }

    canvasRef.current.width = canvasContainerRef.current.clientWidth;
    canvasRef.current.height = canvasContainerRef.current.clientHeight;
  }, []);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!canvasRef.current) {
        return;
      }

      glupo.game.handleMouseMove(canvasRef.current, event);
    };

    const handleMouseLeft = () => {
      if (!canvasRef.current) {
        return;
      }

      glupo.game.handleMouseLeft();
    };

    const handleMouseEnter = () => {
      if (!canvasRef.current) {
        return;
      }

      glupo.game.handleMouseEnter();
    };

    const canvas = canvasRef.current;

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseenter", handleMouseEnter);
    canvas.addEventListener("mouseleave", handleMouseLeft);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeft);
      canvas.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, [glupo.game]);

  if (glupo.isLoading) {
    return (
      <div className={styles.loading}>
        <p>{t("glupo.loading")}</p>
      </div>
    );
  }

  const { balance, riskLevel } = glupo.gameData!;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>{t("glupo.title")}</h1>
        <div className={cn(styles.balance, glupo.isFullBalance && styles.full)}>
          <p>{formatEnkephalin(balance)}</p>
          <img src={Enkephalin} alt="Enkephalin" width={48} height={24} />
        </div>
      </div>

      <div className={styles.canvas} ref={canvasContainerRef}>
        <canvas ref={canvasRef} />
      </div>

      <div className={styles.name}>
        <img src={RiskLevelIcons[riskLevel]} alt={riskLevel} />
        <p>T-01-23-GLUPO</p>
      </div>

      <NavLink
        to="/about/glupo/shop"
        className={cn(styles.shop, glupo.isFullBalance && styles.blink)}
        replace
      >
        {t("glupo.shop.button")}
      </NavLink>
    </div>
  );
}

export default observer(Page);
