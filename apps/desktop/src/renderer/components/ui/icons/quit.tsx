import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    viewBox="0 0 100 100"
    {...props}
  >
    <g
      style={{
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    >
      <path d="M50 10v35M26 20C-3 48 16 90 51 90c28 0 38-23 38-38s-8-26-15-32" />
    </g>
  </svg>
)
export default SvgComponent
