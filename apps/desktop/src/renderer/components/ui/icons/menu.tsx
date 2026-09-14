import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    aria-hidden="true"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      d="M10 3C6.134 3 4.201 3 3 4.201 2 5.402 2 7.335 2 11v2c0 3.866 0 5.799 1.201 7 1.201 1.201 3.134 1.201 7 1.201H14c3.866 0 5.799 0 7-1.201 1.201-1.201 1.201-3.134 1.201-7v-.5M10 3h1.25"
    />
    <rect
      width={9.5}
      height={9.5}
      x={12.25}
      y={2.25}
      stroke="currentColor"
      strokeWidth={1.5}
      rx={2.25}
    />
  </svg>
)
export default SvgComponent
