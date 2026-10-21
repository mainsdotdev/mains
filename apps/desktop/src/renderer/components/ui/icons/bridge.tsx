import { SVGProps, useId } from "react";

const MARK =
  "M5.63 3.046C8.889 8.383 12 10.756 16 10.756c4 0 7.111-2.373 10.37-7.71.593-.89 1.334-1.038 1.926 0C30.666 6.308 32 10.459 32 15.5c0 5.04-1.333 9.192-3.704 12.454-.592 1.038-1.333.89-1.926 0-3.259-5.338-6.37-7.71-10.37-7.71-4 0-7.111 2.372-10.37 7.71-.593.89-1.334 1.038-1.926 0C1.334 24.692 0 20.54 0 15.5c0-5.04 1.333-9.192 3.704-12.454.592-1.038 1.333-.89 1.926 0Z";

// The website's Bridge hero runs many lanes through the mark; at 14-16px one
// lane through the waist is what stays legible.
const LANE = "M0 15.5H32";

// A square box with the mark at 85% of its width, like the padding the 24px
// icons beside it keep; a mark that fills its box reads larger than they do.
const BOX = 32 / 0.85;
const VIEW_BOX = `${(32 - BOX) / 2} ${15 - BOX / 2} ${BOX} ${BOX}`;
// Their 1.5/24 line weight in this box.
const LINE = (1.5 * BOX) / 24;

const SvgComponent = ({ filled: _filled, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => {
  const maskId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      fill="none"
      {...props}
      viewBox={VIEW_BOX}
    >
      {/* Alpha masking keeps the outline fully opaque for every inherited tint,
          and keeps the lane inside the mark. Only the inner half of the outline
          shows, so it is drawn twice as wide as the lane. */}
      <mask id={maskId} fill="currentColor" style={{ maskType: "alpha" }}>
        <path d={MARK} />
      </mask>
      <g stroke="currentColor" mask={`url(#${maskId})`}>
        <path strokeWidth={2 * LINE} d={MARK} />
        <path strokeWidth={LINE} d={LANE} />
      </g>
    </svg>
  );
};

export default SvgComponent;
