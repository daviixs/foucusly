import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  radius: number;
  twinkleSpeed: number;
  twinklePhase: number;
  opacity: number;
  driftX: number;
  driftY: number;
};

type ShootingStar = {
  x: number;
  y: number;
  angle: number;
  speed: number;
  length: number;
  life: number;
  maxLife: number;
};

const randomGenerator = (seed: number) => {
  let state = seed | 0;
  const next = () => {
    let value = (state += 1831565813);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
  };
};

function makeStarTexture() {
  const texture = document.createElement("canvas");
  texture.width = 32;
  texture.height = 32;
  const context = texture.getContext("2d");
  if (!context) return texture;

  const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.1, "rgba(255,255,255,1)");
  glow.addColorStop(1, "rgba(255,94,94,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 32, 32);
  return texture;
}

export default function DarkStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return;

    const rng = randomGenerator(Math.floor(Date.now() / 86400000));
    const stars: Star[] = Array.from({ length: 340 }, (_, index) => ({
      x: rng.next(),
      y: rng.next(),
      radius: index % 2 === 0 ? 2.1 : 2.6,
      twinkleSpeed: rng.range(0.4, 1.8),
      twinklePhase: rng.range(0, Math.PI * 2),
      opacity: rng.range(0.15, 0.45),
      driftX: rng.range(-0.0003, 0.0003),
      driftY: rng.range(-0.00015, 0.00015),
    }));
    const shootingStars: ShootingStar[] = [];
    const texture = makeStarTexture();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let elapsed = 0;
    let shootingCountdown = rng.range(4, 10);
    let previousTime = 0;
    let frame = 0;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      draw();
    };

    const draw = () => {
      if (width === 0 || height === 0) return;
      context.clearRect(0, 0, width, height);
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0.2163, "rgb(38, 67, 138)");
      sky.addColorStop(1, "rgb(83, 67, 155)");
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "color-dodge";

      const sweep = reducedMotion ? 0 : (Math.sin(elapsed * 0.15) + 1) / 2;
      for (const star of stars) {
        const twinkle = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(elapsed * star.twinkleSpeed + star.twinklePhase);
        const sweepDistance = Math.abs(star.x - sweep);
        const sweepBoost = reducedMotion ? 0 : Math.max(0, 1 - sweepDistance * 2.5) * 0.5;
        let opacity = reducedMotion ? star.opacity : star.opacity * (0.3 + 0.7 * twinkle) + sweepBoost;
        const radius = star.radius * 2.5 * (reducedMotion ? 1 : 0.8 + 0.4 * twinkle);
        if (star.x < 0.35 && star.y > 0.65) opacity *= 0.15;
        context.globalAlpha = Math.min(opacity, 1);
        context.drawImage(texture, star.x * width - radius / 2, star.y * height - radius / 2, radius, radius);
      }

      for (const star of shootingStars) {
        const x = star.x * width;
        const y = star.y * height;
        const tailX = x - Math.cos(star.angle) * star.length * width;
        const tailY = y - Math.sin(star.angle) * star.length * height;
        const progress = 1 - star.life / star.maxLife;
        const opacity = progress < 0.2 ? progress / 0.2 : (1 - progress) / 0.8;
        const trail = context.createLinearGradient(tailX, tailY, x, y);
        trail.addColorStop(0, "rgba(255,255,255,0)");
        trail.addColorStop(1, `rgba(255,255,255,${Math.max(opacity, 0) * 0.8})`);
        context.beginPath();
        context.strokeStyle = trail;
        context.lineWidth = 1.5;
        context.moveTo(tailX, tailY);
        context.lineTo(x, y);
        context.stroke();
      }

      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
    };

    const tick = (time: number) => {
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      elapsed += delta;
      for (const star of stars) {
        star.x = (((star.x + star.driftX * delta) % 1) + 1) % 1;
        star.y = (((star.y + star.driftY * delta) % 1) + 1) % 1;
      }
      shootingCountdown -= delta;
      if (shootingCountdown <= 0) {
        const life = rng.range(1.2, 2.5);
        shootingStars.push({
          x: rng.range(0.1, 0.9),
          y: rng.range(0.05, 0.4),
          angle: rng.range(Math.PI * 0.1, Math.PI * 0.4),
          speed: rng.range(0.15, 0.35),
          length: rng.range(0.06, 0.12),
          life,
          maxLife: life,
        });
        shootingCountdown = rng.range(5, 15);
      }
      for (const star of shootingStars) {
        star.x += Math.cos(star.angle) * star.speed * delta;
        star.y += Math.sin(star.angle) * star.speed * delta;
        star.life -= delta;
      }
      for (let index = shootingStars.length - 1; index >= 0; index -= 1) {
        if (shootingStars[index].life <= 0) shootingStars.splice(index, 1);
      }
      draw();
      frame = window.requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    if (!reducedMotion) {
      previousTime = performance.now();
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="craft-dark-starfield" aria-hidden="true" />;
}
