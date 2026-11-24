"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#0A0A0C", "#16A34A", "#52525B", "#A1A1AA", "#EAB308"];

/**
 * Lightweight, reduced-motion-respecting celebratory confetti burst (zero external dependencies).
 * Fires once per mount/triggerKey and cleans up automatically after ~1.9s.
 */
export function ConfettiBurst({ triggerKey }: { triggerKey: string | number | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!triggerKey) return;
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const originX = width * 0.55;
    const originY = Math.min(height * 0.34, 300);

    const particles = Array.from({ length: 52 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = 4.5 + Math.random() * 6.5;
      return {
        x: originX + (Math.random() - 0.5) * 40,
        y: originY + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        w: 5 + Math.random() * 4,
        h: 3 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.22,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        life: 0,
        maxLife: 75 + Math.random() * 35,
      };
    });

    let rafId = 0;
    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      let alive = 0;

      for (const p of particles) {
        p.life += 1;
        if (p.life >= p.maxLife) continue;
        alive += 1;

        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22; // gentle gravity
        p.vx *= 0.985;
        p.rot += p.vrot;

        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (alive > 0) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, width, height);
    };
  }, [triggerKey]);

  if (!triggerKey) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
    />
  );
}
