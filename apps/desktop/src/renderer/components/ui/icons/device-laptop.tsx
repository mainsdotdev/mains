import type { SVGProps } from "react";

const DeviceLaptop = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect x={4.25} y={3.25} width={15.5} height={12.5} rx={1.75} stroke="currentColor" strokeWidth={1.5} />
    <path d="m4.25 15.75-2 3a1.25 1.25 0 0 0 1.04 2h17.42a1.25 1.25 0 0 0 1.04-2l-2-3M10 17.75h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
  </svg>
);

export default DeviceLaptop;
