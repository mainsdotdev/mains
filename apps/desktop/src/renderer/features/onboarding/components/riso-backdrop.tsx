import { useId } from "react";
import { cn } from "@/lib/cn";

interface RisoBackdropProps {
  className?: string;
}

/** Two offset ink passes, with a halftone screen and gaps in the ink. */
export function RisoBackdrop({ className }: RisoBackdropProps) {
  const id = useId();
  const dotsId = `${id}-dots`;
  const screenId = `${id}-screen`;
  const grainId = `${id}-grain`;

  return (
    <svg
      className={cn("onboarding-riso", className)}
      viewBox="0 0 480 400"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={dotsId}
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-16)"
        >
          <circle cx="1.5" cy="1.5" r="0.9" fill="white" />
        </pattern>
        <mask id={screenId}>
          <rect width="480" height="400" fill={`url(#${dotsId})`} />
        </mask>
        <filter id={grainId} colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.72"
            numOctaves="3"
            seed="12"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0 1
                    2.5 2.5 2.5 0 -3.3"
            result="inkCoverage"
          />
          <feComposite
            in="SourceGraphic"
            in2="inkCoverage"
            operator="in"
          />
        </filter>
      </defs>

      <g
        className="onboarding-riso-ink onboarding-riso-ink-warm"
        transform="rotate(-12 240 200)"
      >
        <path
          d="M83 110C100 78 167 55 218 56C255 57 275 79 271 116L259 238C256 270 228 288 194 280L95 252C68 244 56 221 64 190Z"
          opacity="0.07"
        />
        <path
          d="M87 106C104 74 171 51 222 52C259 53 279 75 275 112L263 234C260 266 232 284 198 276L99 248C72 240 60 217 68 186Z"
          mask={`url(#${screenId})`}
          filter={`url(#${grainId})`}
        />
      </g>
      <g
        className="onboarding-riso-ink onboarding-riso-ink-accent"
        transform="rotate(14 240 200)"
      >
        <path
          d="M227 106C254 82 284 89 310 106L391 164C417 183 426 215 406 244L358 315C343 339 316 348 291 333L206 283C179 267 176 236 188 208Z"
          opacity="0.07"
        />
        <path
          d="M222 110C249 86 279 93 305 110L386 168C412 187 421 219 401 248L353 319C338 343 311 352 286 337L201 287C174 271 171 240 183 212Z"
          mask={`url(#${screenId})`}
          filter={`url(#${grainId})`}
        />
      </g>
    </svg>
  );
}
