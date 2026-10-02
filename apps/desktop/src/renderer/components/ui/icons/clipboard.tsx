import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M7.5 14.5c0-3.3 0-4.95 1.025-5.975C9.55 7.5 11.2 7.5 14.5 7.5s4.95 0 5.975 1.025C21.5 9.55 21.5 11.2 21.5 14.5s0 4.95-1.025 5.975C19.45 21.5 17.8 21.5 14.5 21.5s-4.95 0-5.975-1.025C7.5 19.45 7.5 17.8 7.5 14.5Z" />
    <path d="M7.5 16.5c-1.396 0-2.095 0-2.656-.196a3.5 3.5 0 0 1-2.148-2.148C2.5 13.595 2.5 12.896 2.5 11.5v-2c0-3.3 0-4.95 1.025-5.975C4.55 2.5 6.2 2.5 9.5 2.5h2c1.396 0 2.095 0 2.656.196a3.5 3.5 0 0 1 2.148 2.148c.196.561.196 1.26.196 2.656" />
  </svg>
)
export default SvgComponent
