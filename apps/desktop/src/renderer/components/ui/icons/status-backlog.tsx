import { SVGProps } from "react";

const StatusBacklog = (props: SVGProps<SVGSVGElement>) => (
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
      strokeWidth={2}
      strokeDasharray="1.5 1.77"
    />
  </svg>
);

export default StatusBacklog;
