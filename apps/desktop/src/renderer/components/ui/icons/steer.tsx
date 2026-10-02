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
    <path d="M19 15h-7c-3.771 0-5.657 0-6.828-1.172C4 12.657 4 10.771 4 7V4" />
    <path d="M15 20s5-3.682 5-5-5-5-5-5" />
  </svg>
)
export default SvgComponent
