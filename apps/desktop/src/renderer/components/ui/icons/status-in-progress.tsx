import { SVGProps } from "react";

const StatusInProgress = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    {...props}
  >
    <circle
      cx={8}
      cy={8}
      r={6.25}
      stroke="currentColor"
      strokeWidth={1.75}
    />
    <path fill="currentColor" d="M8 3.75a4.25 4.25 0 0 1 0 8.5V3.75Z" />
  </svg>
);

export default StatusInProgress;
