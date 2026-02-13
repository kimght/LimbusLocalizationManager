import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrinketId, trinkets } from "@/stores/glupo/trinket";
import { rootStore } from "@/stores";
import styles from "./gacha.module.css";
import { cn } from "@/utils";
import { useTranslation } from "react-i18next";
import LightShard from "@/assets/icons/glupo/ui/light-shard.webp";

type ReelState = {
  reelItems: TrinketId[];
  reelOffset: number;
  targetOffset: number;
  startTime: number;
  duration: number;
  lastTickIndex: number;
  winnerIndex: number;
  used: boolean;
};

const ease = (x: number) => {
  return 1 - Math.pow(1 - x, 4);
};

const reelParams = {
  itemSize: 72,
  itemSpacing: 16,
  reelHeight: 128,
  minScale: 1,
  maxScale: 1.25,
  startScale: 0.75,
};

function Gacha() {
  const { glupo } = rootStore;
  const { t } = useTranslation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reelStateRef = useRef<ReelState>({
    reelItems: [],
    reelOffset: 0,
    targetOffset: 0,
    startTime: 0,
    duration: 5000,
    lastTickIndex: -1,
    winnerIndex: -1,
    used: false,
  });

  const [isSpinning, setIsSpinning] = useState<boolean>(false);

  const isSpinningRef = useRef<boolean>(isSpinning);
  useEffect(() => {
    isSpinningRef.current = isSpinning;
  }, [isSpinning]);

  const draw = useCallback(
    (timestamp: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const { width, height } = ctx.canvas;

      ctx.clearRect(0, 0, width, height);

      const imageAssets = glupo.imageAssets!;
      const anim = reelStateRef.current;
      const timeElapsed = timestamp - anim.startTime;
      const progress = Math.min(timeElapsed / anim.duration, 1);
      const easedProgress = ease(progress);

      anim.reelOffset = easedProgress * anim.targetOffset;

      const totalItemWidth = reelParams.itemSize + reelParams.itemSpacing;
      const center = width / 2;
      const currentItemIndex = Math.floor(anim.reelOffset / totalItemWidth);

      if (isSpinningRef.current && anim.lastTickIndex !== currentItemIndex) {
        const sound =
          currentItemIndex % 2 === 0 ? "gacha.tick-1" : "gacha.tick-2";

        glupo.soundManager?.play(sound);
        anim.lastTickIndex = currentItemIndex;
      }

      anim.reelItems.forEach((item, index) => {
        const itemCenter = center - anim.reelOffset + index * totalItemWidth;
        const distanceFromCenter = Math.abs(itemCenter - center);
        if (distanceFromCenter > width) return;

        const scaleFactor = Math.max(
          0.75,
          1 - distanceFromCenter / (width * 0.75)
        );
        const scale = 0.25 + scaleFactor;

        const scaledWidth = reelParams.itemSize * scale;
        const scaledHeight = reelParams.itemSize * scale;
        const x = itemCenter - scaledWidth / 2;
        const y = height / 2 - scaledHeight / 2;

        const trinket = trinkets[item];
        const trinketImage = imageAssets[trinket.image].img;

        if (progress >= 1 && index === anim.winnerIndex) {
          ctx.shadowColor = "rgba(223, 162, 48, 0.6)";
          ctx.shadowBlur = 15;
        }

        ctx.drawImage(trinketImage, x, y, scaledWidth, scaledHeight);

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      });

      if (progress < 1) {
        requestAnimationFrame(draw);
      } else {
        setIsSpinning(false);

        if (anim.used) {
          glupo.soundManager?.play("gacha.fanfare");
          return;
        }
      }
    },
    [glupo.imageAssets, glupo.soundManager]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reel = glupo.createTrinketReel();
    const totalItemWidth = reelParams.itemSize + reelParams.itemSpacing;
    reelStateRef.current.reelItems = reel;
    reelStateRef.current.targetOffset = (reel.length / 2) * totalItemWidth;

    const resizeCanvas = () => {
      const { width } = canvas.parentElement!.getBoundingClientRect();
      canvas.width = width;
      canvas.height = reelParams.reelHeight;
      requestAnimationFrame((ts) => draw(ts + reelStateRef.current.duration));
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [draw, glupo]);

  return (
    <div className={styles.container}>
      <div className={styles.reel} style={{ height: reelParams.reelHeight }}>
        <canvas ref={canvasRef} />
        <div
          className={styles.pointer}
          style={{
            width:
              reelParams.itemSize * reelParams.maxScale +
              reelParams.itemSpacing / 2,
            height:
              reelParams.itemSize * reelParams.maxScale +
              reelParams.itemSpacing / 2,
          }}
        />

        <div className={cn(styles.shadow, styles.left)} />
        <div className={cn(styles.shadow, styles.right)} />
      </div>

      <button
        className={cn(styles.button, isSpinning && styles.spinning)}
        onClick={handleSpin}
        disabled={
          isSpinning || glupo.gameData!.lightShards < glupo.trinketRollCost
        }
      >
        <p>{t("glupo.light-shop.trinket-gacha-roll")}</p>

        <span>
          {glupo.trinketRollCost}
          <img src={LightShard} alt="Light Shard" width={24} height={24} />
        </span>
      </button>
    </div>
  );

  function handleSpin() {
    if (isSpinning) return;

    const roll = glupo.buyTrinketRoll();
    if (!roll) return;

    setIsSpinning(true);

    const { reel, winnerIndex } = roll;

    const anim = reelStateRef.current;
    const totalItemWidth = reelParams.itemSize + reelParams.itemSpacing;

    anim.reelItems = reel;
    anim.targetOffset = winnerIndex * totalItemWidth;
    anim.startTime = performance.now();
    anim.reelOffset = 0;
    anim.lastTickIndex = -1;
    anim.used = true;
    anim.winnerIndex = winnerIndex;

    requestAnimationFrame(draw);
  }
}

export default observer(Gacha);
