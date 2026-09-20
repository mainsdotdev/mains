import * as React from "react";
import type { SVGProps } from "react";

const DeviceMobile = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect
      x={6.25}
      y={2.25}
      width={11.5}
      height={19.5}
      rx={2.75}
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <path
      d="M10 5h4M10.75 18.75h2.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
    />
  </svg>
);

export default DeviceMobile;
