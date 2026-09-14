import { useEffect, useRef, useCallback, type RefObject } from "react";

interface Particle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  phase: number;
  freq: number;
}

export interface ParticleLogoOptions {
  svgPaths: string[];
  svgViewBox: string;
  color: string;
  text?: string;
  logoSize?: number;
  particleGap?: number;
  mouseRadius?: number;
  renderMode?: "fill" | "stroke";
  strokeWidth?: number;
  enabled: boolean;
}

const DEFAULTS = {
  logoSize: 80,
  particleGap: 2,
  mouseRadius: 30,
  mouseForce: 4,
  returnSpeed: 0.08,
  friction: 0.6,
  particleSize: 1,
  idleAmplitude: 0.5,
  idleSpeed: 0.25,
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function samplePixels(
  canvas: HTMLCanvasElement,
  gap: number
): Array<{ x: number; y: number }> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < canvas.height; y += gap) {
    for (let x = 0; x < canvas.width; x += gap) {
      const i = (y * canvas.width + x) * 4;
      if (imageData.data[i + 3] > 128) {
        pixels.push({ x, y });
      }
    }
  }

  return pixels;
}

function renderLogoToCanvas(
  svgPaths: string[],
  svgViewBox: string,
  renderSize: number,
  renderMode: "fill" | "stroke",
  strokeWidth: number
): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  offscreen.width = renderSize;
  offscreen.height = renderSize;
  const ctx = offscreen.getContext("2d")!;

  const [vx, vy, vw, vh] = svgViewBox.split(" ").map(Number);
  const scale = renderSize / Math.max(vw, vh);

  ctx.save();
  ctx.translate(-vx * scale, -vy * scale);
  ctx.scale(scale, scale);

  for (const d of svgPaths) {
    const path2d = new Path2D(d);
    if (renderMode === "stroke") {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(path2d);
    } else {
      ctx.fillStyle = "#000";
      ctx.fill(path2d);
    }
  }

  ctx.restore();
  return offscreen;
}

function renderTextToCanvas(
  text: string,
  maxWidth: number,
  fontWeight: number | string = 300,
  letterSpacing: number = 1 
): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  const ctx = offscreen.getContext("2d")!;

  const fontSize = 24;
  const fontFamily = `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) {
    const charWidth = ctx.measureText(text[i]).width;
    totalWidth += charWidth;
    if (i < text.length - 1) totalWidth += letterSpacing;
  }

  const textWidth = Math.min(totalWidth, maxWidth);
  const textHeight = fontSize;

  offscreen.width = Math.ceil(textWidth) + 4;
  offscreen.height = Math.ceil(textHeight) + 4;

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let x = 2;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    ctx.fillText(char, x, 3);
    x += ctx.measureText(char).width + letterSpacing;
  }

  return offscreen;
}

export function useParticleLogo(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: ParticleLogoOptions
): void {
  const {
    svgPaths,
    svgViewBox,
    color,
    text,
    logoSize = DEFAULTS.logoSize,
    particleGap = DEFAULTS.particleGap,
    mouseRadius = DEFAULTS.mouseRadius,
    renderMode = "fill",
    strokeWidth = 2,
    enabled,
  } = options;

  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef<{ x: number; y: number; present: boolean }>({
    x: 0,
    y: 0,
    present: false,
  });
  const frameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const initParticles = useCallback(
    (canvasW: number, canvasH: number) => {
      const allParticles: Particle[] = [];

      const logoCanvas = renderLogoToCanvas(svgPaths, svgViewBox, logoSize, renderMode, strokeWidth);
      const logoPixels = samplePixels(logoCanvas, particleGap);

      const logoOffsetX = (canvasW - logoSize) / 2;
      const logoOffsetY = (canvasH - logoSize) / 2 - (text ? 20 : 0);

      for (const p of logoPixels) {
        const x = p.x + logoOffsetX;
        const y = p.y + logoOffsetY;
        allParticles.push({ x, y, homeX: x, homeY: y, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2, freq: 0.8 + Math.random() * 0.4 });
      }

      if (text) {
        const textCanvas = renderTextToCanvas(text, canvasW * 0.8);
        const textPixels = samplePixels(textCanvas, 1);

        const textOffsetX = (canvasW - textCanvas.width) / 2;
        const textOffsetY = logoOffsetY + logoSize + 24;

        for (const p of textPixels) {
          const x = p.x + textOffsetX;
          const y = p.y + textOffsetY;
          allParticles.push({ x, y, homeX: x, homeY: y, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2, freq: 0.8 + Math.random() * 0.4 });
        }
      }

      particlesRef.current = allParticles;
    },
    [svgPaths, svgViewBox, logoSize, particleGap, renderMode, strokeWidth, text]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles(rect.width, rect.height);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const onMouseEnter = () => {
      mouseRef.current.present = true;
    };
    const onMouseLeave = () => {
      mouseRef.current.present = false;
    };

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseenter", onMouseEnter);
    canvas.addEventListener("mouseleave", onMouseLeave);

    if (!enabled) {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawFrame(ctx, particlesRef.current, color);
      return () => {
        observer.disconnect();
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.removeEventListener("mouseenter", onMouseEnter);
        canvas.removeEventListener("mouseleave", onMouseLeave);
      };
    }

    const animate = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      ctx.clearRect(0, 0, w, h);
      timeRef.current += DEFAULTS.idleSpeed;
      const t_idle = timeRef.current;

      for (const p of particles) {
        // Idle breathing — hafif salınım
        const idleX = Math.sin(t_idle * p.freq + p.phase) * DEFAULTS.idleAmplitude;
        const idleY = Math.cos(t_idle * p.freq * 0.7 + p.phase + 1) * DEFAULTS.idleAmplitude * 0.6;

        if (mouse.present) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const distSq = dx * dx + dy * dy;
          const radiusSq = mouseRadius * mouseRadius;

          if (distSq < radiusSq && distSq > 0.1) {
            const dist = Math.sqrt(distSq);
            const t = 1 - dist / mouseRadius;
            const strength = t * t * t;

            p.vx += (dx / dist) * strength * DEFAULTS.mouseForce;
            p.vy += (dy / dist) * strength * DEFAULTS.mouseForce;
          }
        }

        p.vx += (p.homeX + idleX - p.x) * DEFAULTS.returnSpeed;
        p.vy += (p.homeY + idleY - p.y) * DEFAULTS.returnSpeed;

        p.vx *= DEFAULTS.friction;
        p.vy *= DEFAULTS.friction;

        p.x += p.vx;
        p.y += p.vy;
      }

      drawFrame(ctx, particles, color);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseenter", onMouseEnter);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [canvasRef, color, logoSize, particleGap, mouseRadius, enabled, initParticles]);
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  color: string
) {
  const [r, g, b] = hexToRgb(color);
  const size = DEFAULTS.particleSize;

  for (const p of particles) {
    const dx = p.x - p.homeX;
    const dy = p.y - p.homeY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const alpha = Math.max(0.3, 1 - dist * 0.03);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillRect(p.x - size * 0.5, p.y - size * 0.5, size, size);
  }
}
