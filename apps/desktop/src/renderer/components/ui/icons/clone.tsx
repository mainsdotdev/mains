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
    <path d="M17 14H7c-1.4 0-2.1 0-2.635.273a2.5 2.5 0 0 0-1.093 1.092C3 15.9 3 16.6 3 18c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.092C4.9 22 5.6 22 7 22h10c1.4 0 2.1 0 2.635-.273a2.5 2.5 0 0 0 1.092-1.092C21 20.1 21 19.4 21 18c0-1.4 0-2.1-.273-2.635a2.5 2.5 0 0 0-1.092-1.092C19.1 14 18.4 14 17 14Z" />
    <path d="M7 18v-.2m.25.2a.25.25 0 1 0-.5 0 .25.25 0 0 0 .5 0ZM11 18v-.2m.25.2a.25.25 0 1 0-.5 0 .25.25 0 0 0 .5 0ZM8 6s2.946 4 4 4c1.054 0 4-4 4-4m-4 3V2" />
  </svg>
)
export default SvgComponent
