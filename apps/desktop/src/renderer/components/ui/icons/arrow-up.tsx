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
    strokeWidth={2}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M18 15s-4.419-6-6-6c-1.581 0-6 6-6 6" />
  </svg>
)
export default SvgComponent
