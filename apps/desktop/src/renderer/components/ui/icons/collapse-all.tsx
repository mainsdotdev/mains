import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 4.5h9A1.5 1.5 0 0 1 19.5 6v9"
    />
    <rect
      x={4.5}
      y={8.5}
      width={11}
      height={11}
      rx={2}
      stroke="currentColor"
      strokeWidth={1.5}
    />
    <path
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      d="M7.75 14h4.5"
    />
  </svg>
)
export default SvgComponent
