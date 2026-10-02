import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <circle cx={12} cy={12} r={10} />
    <ellipse cx={12} cy={12} rx={4} ry={10} />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20" />
  </svg>
)
export default SvgComponent
