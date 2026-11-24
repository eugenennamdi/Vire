"use client";

import { useEffect, useRef } from "react";

const STRAND_COUNT = 44;
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  strand: (i * 2) % STRAND_COUNT,
  t: (i * 0.131) % 1,
  speed: 0.0011 + (i % 4) * 0.00028,
  size: 1.05 + (i % 3) * 0.3,
}));

/**
 * 2x Retina 3D ruled hyperboloid clearing sculpture for the Vire hero canvas.
 * Pure monochrome graphite hairlines converging through a focal clearing waist,
 * with subtle spring-lerped pointer parallax and reduced-motion compliance.
 */
export function HeroHyperboloid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let phase = 0.4;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseX = 0;
    let mouseY = 0;
    let rafId = 0;

    // Clone mutable particle positions so remounts stay clean
    const particles = PARTICLES.map((p) => ({ ...p }));

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onPointerMove = (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      targetMouseX = ((e.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2;
      targetMouseY = ((e.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
    };

    const onPointerLeave = () => {
      targetMouseX = 0;
      targetMouseY = 0;
    };

    const drawFrame = () => {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      // Optical bridge between left editorial copy and right institutional figures
      const isCompact = width < 768;
      const cx = width * (isCompact ? 0.68 : 0.555) + mouseX * 12;
      const topY = -36;
      const botY = height + 36;
      const rx = Math.min(width * 0.3, 310);
      const rz = rx * 0.44;
      const twist = 2.86 + mouseX * 0.06;

      const strands: Array<{
        i: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        depth: number;
      }> = [];

      for (let i = 0; i < STRAND_COUNT; i++) {
        const a1 = (i / STRAND_COUNT) * Math.PI * 2 + phase;
        const a2 = a1 + twist;

        const x1 = cx + Math.cos(a1) * rx;
        const z1 = Math.sin(a1) * rz;
        const x2 = cx + Math.cos(a2) * rx;
        const z2 = Math.sin(a2) * rz;

        const zMid = (z1 + z2) * 0.5;
        const depth = (zMid / rz + 1) * 0.5;

        strands.push({ i, x1, y1: topY, x2, y2: botY, depth });
      }

      strands.sort((a, b) => a.depth - b.depth);

      for (const s of strands) {
        const alpha = 0.032 + s.depth * 0.165;
        const grad = ctx.createLinearGradient(s.x1, s.y1, s.x2, s.y2);
        grad.addColorStop(0, `rgba(10, 10, 16, ${alpha * 0.16})`);
        grad.addColorStop(0.24, `rgba(10, 10, 16, ${alpha * 0.82})`);
        grad.addColorStop(0.5, `rgba(10, 10, 16, ${alpha * 1.2})`);
        grad.addColorStop(0.76, `rgba(10, 10, 16, ${alpha * 0.78})`);
        grad.addColorStop(1, `rgba(10, 10, 16, ${alpha * 0.12})`);

        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.depth > 0.65 ? 0.9 : 0.68;
        ctx.stroke();
      }

      // Whisper-fine clearing focal ring around the mathematical waist
      const waistR = rx * Math.abs(Math.cos(twist * 0.5));
      ctx.beginPath();
      ctx.ellipse(
        cx,
        (topY + botY) * 0.5 + mouseY * 4,
        waistR * 1.08,
        waistR * 0.28,
        0,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = "rgba(10, 10, 16, 0.11)";
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Subtle precision micro-nodes gliding along front strands
      const byIndex = new Map(strands.map((s) => [s.i, s]));
      for (const p of particles) {
        const s = byIndex.get(p.strand);
        if (!s || s.depth < 0.35) continue;
        const px = s.x1 + (s.x2 - s.x1) * p.t;
        const py = s.y1 + (s.y2 - s.y1) * p.t;
        const edgeFade = Math.sin(p.t * Math.PI);
        const nodeAlpha = edgeFade * (0.16 + s.depth * 0.44);
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10, 10, 16, ${nodeAlpha})`;
        ctx.fill();
      }
    };

    const tick = () => {
      if (!reduceMotion) {
        phase += 0.0009;
        for (const p of particles) {
          p.t = (p.t + p.speed) % 1;
        }
      }
      drawFrame();
      if (!reduceMotion) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      drawFrame();
    });
    ro.observe(stage);

    if (!reduceMotion) {
      stage.addEventListener("mousemove", onPointerMove, { passive: true });
      stage.addEventListener("mouseleave", onPointerLeave, { passive: true });
    }

    tick();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      ro.disconnect();
      stage.removeEventListener("mousemove", onPointerMove);
      stage.removeEventListener("mouseleave", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
