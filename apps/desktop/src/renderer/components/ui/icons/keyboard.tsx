import type { SVGProps } from "react";

const Keyboard = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    {...props}
  >
    <rect
      x="2.5"
      y="5.5"
      width="19"
      height="13"
      rx="3"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path
      d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13.5h.01M9 13.5h.01M12 13.5h.01M15 13.5h.01M18 13.5h.01M8 16h8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export default Keyboard;
