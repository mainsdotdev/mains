import type { SVGProps } from "react";

const DeviceDesktop = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect x={2.25} y={3.25} width={19.5} height={13.5} rx={2.25} stroke="currentColor" strokeWidth={1.5} />
    <path d="M12 16.75v4M8 20.75h8" stroke="currentColor" strokeLinecap="round" strokeWidth={1.5} />
  </svg>
);

export default DeviceDesktop;
