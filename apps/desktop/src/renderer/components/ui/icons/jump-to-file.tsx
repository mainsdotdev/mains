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
    <path d="M20.5 12.5v-1c0-4.243 0-6.364-1.318-7.682C17.864 2.5 15.742 2.5 11.5 2.5c-4.243 0-6.364 0-7.682 1.318C2.5 5.136 2.5 7.258 2.5 11.5c0 4.243 0 6.364 1.318 7.682C5.136 20.5 7.258 20.5 11.5 20.5h1M3 7.5h17M11.5 16h1m-6 0h1M11.5 12h5m-10 0h1" />
    <path d="m20 20 1.5 1.5m-1-3.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
  </svg>
)
export default SvgComponent
