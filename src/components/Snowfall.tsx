import { useEffect, useRef } from "react";

/** Lightweight falling-snow canvas. Respects prefers-reduced-motion. */
export function Snowfall() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);

    const COUNT = 80;
    const flakes = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2.5 + 1,
      speed: Math.random() * 0.6 + 0.3,
      wind: Math.random() * 0.4 - 0.2,
      opacity: Math.random() * 0.5 + 0.3,
    }));

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${f.opacity})`;
        ctx.fill();
        f.y += f.speed;
        f.x += f.wind + Math.sin(f.y * 0.01) * 0.3;
        if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
        if (f.x > w + 5) f.x = -5;
        if (f.x < -5) f.x = w + 5;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{ mixBlendMode: "screen" }}
      aria-hidden
    />
  );
}
