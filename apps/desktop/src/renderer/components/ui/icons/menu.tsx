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
    <g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <circle cx={6} cy={6} r={3} />
      <circle cx={6} cy={18} r={3} />
      <path d="M12 6h10M12 18h10" />
    </g>
  </svg>
)
export default SvgComponent
