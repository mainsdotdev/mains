import { SVGProps, useId } from "react";

const MARK =
  "M5.63 3.046C8.889 8.383 12 10.756 16 10.756c4 0 7.111-2.373 10.37-7.71.593-.89 1.334-1.038 1.926 0C30.666 6.308 32 10.459 32 15.5c0 5.04-1.333 9.192-3.704 12.454-.592 1.038-1.333.89-1.926 0-3.259-5.338-6.37-7.71-10.37-7.71-4 0-7.111 2.372-10.37 7.71-.593.89-1.334 1.038-1.926 0C1.334 24.692 0 20.54 0 15.5c0-5.04 1.333-9.192 3.704-12.454.592-1.038 1.333-.89 1.926 0Z";

// The website's Bridge hero lanes, reduced to three so they stay distinct at
// 14px: the outer two run inside the outline at the waist and fan out through
// the sides, at the outline's visible stroke width.
const LANES =
  "M-2.37 8.5C7.01 8.5 10.27 11.756 16 11.756S24.99 8.5 34.37 8.5M0 15.5H32M-2.37 22.5C7.01 22.5 10.27 19.244 16 19.244S24.99 22.5 34.37 22.5";

const SvgComponent = (props: SVGProps<SVGSVGElement>) => {
  const maskId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={32}
      height={30}
      fill="none"
      {...props}
      viewBox="0 0 32 30"
    >
      {/* Alpha masking keeps the outline fully opaque for every inherited tint,
          and keeps the lanes inside the mark. */}
      <mask id={maskId} fill="currentColor" style={{ maskType: "alpha" }}>
        <path d={MARK} />
      </mask>
      <g stroke="currentColor" mask={`url(#${maskId})`}>
        <path strokeWidth={4} d={MARK} />
        <path strokeWidth={1.5} d={LANES} />
      </g>
    </svg>
  );
};

export default SvgComponent;
