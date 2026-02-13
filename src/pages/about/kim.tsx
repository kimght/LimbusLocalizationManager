import { useEffect, useRef, useState } from "react";

import KimC from "../../assets/icons/kim/KimC.png";
import KimDD from "../../assets/icons/kim/KimDD.png";
import KimDL from "../../assets/icons/kim/KimDL.png";
import KimDR from "../../assets/icons/kim/KimDR.png";
import KimLL from "../../assets/icons/kim/KimLL.png";
import KimRR from "../../assets/icons/kim/KimRR.png";
import KimUU from "../../assets/icons/kim/KimUU.png";
import KimExplode from "../../assets/icons/kim/KimExplode.gif";
import KimTalk from "../../assets/audio/kim/anime.mp3";
import KimExplodeSound from "../../assets/audio/kim/explode.mp3";

import styles from "./kim.module.css";

const facingDirections = [
  {
    src: KimLL,
    from: 0,
    to: Math.PI / 6,
  },
  {
    src: KimUU,
    from: Math.PI / 6,
    to: (5 * Math.PI) / 6,
  },
  {
    src: KimRR,
    from: (5 * Math.PI) / 6,
    to: (9 * Math.PI) / 8,
  },
  {
    src: KimDR,
    from: (9 * Math.PI) / 8,
    to: (11 * Math.PI) / 8,
  },
  {
    src: KimDD,
    from: (11 * Math.PI) / 8,
    to: (13 * Math.PI) / 8,
  },
  {
    src: KimDL,
    from: (13 * Math.PI) / 8,
    to: (15 * Math.PI) / 8,
  },
  {
    src: KimLL,
    from: (15 * Math.PI) / 8,
    to: 2 * Math.PI,
  },
];

function Kim() {
  const ref = useRef<HTMLImageElement>(null);
  const clickCount = useRef<number>(0);
  const isExploding = useRef<boolean>(false);
  const kimExplodeAudio = useRef<HTMLAudioElement>(new Audio(KimExplodeSound));
  const [exploded, setExploded] = useState<boolean>(false);

  useEffect(() => {
    if (exploded) return;

    const handleMouseLeave = () => {
      if (!ref.current) return;
      if (isExploding.current) return;
      ref.current.src = KimC;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      if (isExploding.current) return;

      const { clientX, clientY } = e;
      const { width, height, left, top } = ref.current.getBoundingClientRect();

      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const angle = Math.atan2(clientY - centerY, clientX - centerX) + Math.PI;
      const distance = Math.sqrt(
        (clientX - centerX) ** 2 + (clientY - centerY) ** 2
      );

      if (distance < 94 / 3) {
        ref.current.src = KimC;
        return;
      }

      for (const direction of facingDirections) {
        if (angle >= direction.from && angle <= direction.to) {
          ref.current.src = direction.src;
          return;
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [exploded]);

  if (exploded) {
    return null;
  }

  return (
    <button onClick={handleClick}>
      <img src={KimC} className={styles.kim} alt="" ref={ref} />
    </button>
  );

  function handleClick() {
    if (!ref.current || isExploding.current) {
      return;
    }

    clickCount.current++;

    if (clickCount.current >= 50) {
      ref.current.classList.remove(styles.bounce);
      isExploding.current = true;
      ref.current.src = KimExplode;

      kimExplodeAudio.current.playbackRate = 2;
      kimExplodeAudio.current.play();

      setTimeout(() => {
        setExploded(true);
      }, 800);
    } else {
      ref.current.classList.add(styles.bounce);

      const audio = new Audio(KimTalk);
      audio.playbackRate = 1 + Math.random() * 0.5;
      audio.play();

      setTimeout(() => {
        if (!ref.current) return;
        ref.current.classList.remove(styles.bounce);
      }, 100);
    }
  }
}

export default Kim;
