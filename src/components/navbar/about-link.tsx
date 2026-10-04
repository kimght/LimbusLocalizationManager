import { MouseEvent, useEffect, useRef, useState } from "react";
import { NavLink, NavLinkProps, useNavigate } from "react-router";
import { Info } from "lucide-react";

const TILT_DEG = 45;
const IDLE_MS = 750;
const ROLL_CLICKS = 20;
const ICON_RADIUS_PX = 16; // w-8 h-8
const CEILING_GAP_PX = 8;
const FALL_MS = 400;
const TRANSITIONS = {
  tilt: "transform 300ms ease-out, filter 300ms ease",
  roll: "transform 250ms ease-out, filter 300ms ease",
  fall: `transform ${FALL_MS}ms ease-in, filter 300ms ease`,
} as const;

type Pose = {
  rise: number;
  tilt: number;
  transition: keyof typeof TRANSITIONS;
};

const REST: Pose = { rise: 0, tilt: 0, transition: "tilt" };

function AboutLink({ className }: { className: NavLinkProps["className"] }) {
  const navigate = useNavigate();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const clicks = useRef(0);
  const timer = useRef<number>();
  const fallEndsAt = useRef(0);
  const [pose, setPose] = useState<Pose>(REST);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rollDeg = ((pose.rise / ICON_RADIUS_PX) * 180) / Math.PI;

  return (
    <NavLink
      to="/about"
      ref={linkRef}
      className={className}
      onClick={handleClick}
    >
      <Info
        ref={iconRef}
        className="w-8 h-8 will-change-transform"
        style={{
          transform: `translateY(${-pose.rise}px) rotate(${pose.tilt + rollDeg}deg)`,
          transition: TRANSITIONS[pose.transition],
        }}
      />
    </NavLink>
  );

  function handleClick(event: MouseEvent) {
    const offIcon = !iconRef.current?.contains(event.target as Node);
    if (performance.now() < fallEndsAt.current || (pose.rise > 0 && offIcon)) {
      event.preventDefault();
      return;
    }

    window.clearTimeout(timer.current);
    clicks.current += 1;

    if (clicks.current === 1) {
      setPose({ rise: 0, tilt: TILT_DEG, transition: "tilt" });
      schedule(() => reset("tilt"), IDLE_MS);
      return;
    }

    const maxRise = measureMaxRise();
    const rise = Math.min(
      maxRise,
      ((clicks.current - 1) * maxRise) / ROLL_CLICKS
    );
    setPose({ rise, tilt: TILT_DEG, transition: "roll" });

    if (rise >= maxRise) {
      schedule(() => {
        reset("fall");
        navigate("/about/parkour");
      }, 250);
      return;
    }

    schedule(() => reset("fall"), IDLE_MS);
  }

  function schedule(fn: () => void, ms: number) {
    timer.current = window.setTimeout(fn, ms);
  }

  function reset(transition: Pose["transition"]) {
    clicks.current = 0;
    if (transition === "fall") fallEndsAt.current = performance.now() + FALL_MS;
    setPose({ ...REST, transition });
  }

  function measureMaxRise() {
    const link = linkRef.current;
    const ceiling = link?.previousElementSibling?.querySelector("svg");
    if (!link || !ceiling) return 0;

    const iconTop =
      link.getBoundingClientRect().top +
      parseFloat(getComputedStyle(link).paddingTop);
    const gap = iconTop - ceiling.getBoundingClientRect().bottom;
    return Math.max(0, gap - CEILING_GAP_PX);
  }
}

export default AboutLink;
