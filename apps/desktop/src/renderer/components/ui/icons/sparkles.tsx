import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M3 12a9 9 0 0 0 9-9 9 9 0 0 0 9 9 9 9 0 0 0-9 9 9 9 0 0 0-9-9Z" />
  </svg>
)
export default SvgComponent
