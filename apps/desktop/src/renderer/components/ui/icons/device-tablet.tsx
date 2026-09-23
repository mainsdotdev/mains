import * as React from "react";
import type { SVGProps } from "react";

const DeviceTablet = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect
      x={2.25}
      y={4.25}
      width={19.5}
      height={15.5}
      rx={2.75}
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <path
      d="M10.75 16.75h2.5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
    />
  </svg>
);

export default DeviceTablet;
