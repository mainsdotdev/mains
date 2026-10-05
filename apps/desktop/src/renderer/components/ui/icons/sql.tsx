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
    <ellipse cx={12} cy={5} rx={8} ry={3} />
    <path strokeLinecap="round" d="M7 10.842c.602.18 1.274.33 2 .44" />
    <path d="M20 12c0 1.657-3.582 3-8 3s-8-1.343-8-3" />
    <path strokeLinecap="round" d="M7 17.842c.602.18 1.274.33 2 .44" />
    <path d="M20 5v14c0 1.657-3.582 3-8 3s-8-1.343-8-3V5" />
  </svg>
)
export default SvgComponent
