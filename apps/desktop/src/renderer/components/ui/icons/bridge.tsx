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
    <path d="M3 7c.5 0 2-.5 3-2 1 1.5 3 4 6 4s5-2.5 6-4c1 1.5 2.5 2 3 2M6 4v16M2 16h20M18 4v16M10 9v7M14 9v7" />
  </svg>
)
export default SvgComponent
