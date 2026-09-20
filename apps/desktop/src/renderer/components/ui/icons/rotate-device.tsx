import * as React from "react";
import type { SVGProps } from "react";

const RotateDevice = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect
      x={8.25}
      y={3.25}
      width={7.5}
      height={12.5}
      rx={2.25}
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <path
      d="M5.5 9.25A7 7 0 0 0 16 18.9M17.25 16.5l-.82 2.86 2.82.93"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
    />
  </svg>
);

export default RotateDevice;
