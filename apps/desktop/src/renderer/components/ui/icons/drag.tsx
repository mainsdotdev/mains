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
    <path d="M8.5 19.5v.5m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM15.5 19.5v.5m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM8.5 3.5V4m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM8.5 11.5v.5m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM15.5 3.5V4m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM15.5 11.5v.5m1 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
  </svg>
)
export default SvgComponent
