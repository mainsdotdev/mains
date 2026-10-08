import { SVGProps, useId } from "react";

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
      {/* Alpha masking keeps the outline fully opaque for every inherited tint. */}
      <mask id={maskId} fill="currentColor" style={{ maskType: "alpha" }}>
        <path d="M5.63 3.046C8.889 8.383 12 10.756 16 10.756c4 0 7.111-2.373 10.37-7.71.593-.89 1.334-1.038 1.926 0C30.666 6.308 32 10.459 32 15.5c0 5.04-1.333 9.192-3.704 12.454-.592 1.038-1.333.89-1.926 0-3.259-5.338-6.37-7.71-10.37-7.71-4 0-7.111 2.372-10.37 7.71-.593.89-1.334 1.038-1.926 0C1.334 24.692 0 20.54 0 15.5c0-5.04 1.333-9.192 3.704-12.454.592-1.038 1.333-.89 1.926 0Z" />
      </mask>
      <path
        stroke="currentColor"
        strokeWidth={6}
        d="M5.63 3.046C8.889 8.383 12 10.756 16 10.756c4 0 7.111-2.373 10.37-7.71.593-.89 1.334-1.038 1.926 0C30.666 6.308 32 10.459 32 15.5c0 5.04-1.333 9.192-3.704 12.454-.592 1.038-1.333.89-1.926 0-3.259-5.338-6.37-7.71-10.37-7.71-4 0-7.111 2.372-10.37 7.71-.593.89-1.334 1.038-1.926 0C1.334 24.692 0 20.54 0 15.5c0-5.04 1.333-9.192 3.704-12.454.592-1.038 1.333-.89 1.926 0Z"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

export default SvgComponent;
