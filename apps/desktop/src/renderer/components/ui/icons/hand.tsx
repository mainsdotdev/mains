import type { SVGProps } from "react";

const Hand = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M14 11V6a1.5 1.5 0 0 1 3 0v5" />
    <path d="M17 11V9a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-2.3a6 6 0 0 1-4.5-2L4.3 15.7a1.7 1.7 0 0 1 2.5-2.3L8 14.5" />
  </svg>
);

export default Hand;
