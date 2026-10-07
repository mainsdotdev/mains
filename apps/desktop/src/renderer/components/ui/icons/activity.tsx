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
    <path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10Z" />
    <path d="M2 12.329h4.088c.393 0 .59 0 .76-.08a.89.89 0 0 0 .228-.157c.14-.133.228-.328.404-.718C8.433 9.258 8.91 8.2 9.527 8.04c.289-.075.592-.042.862.094.578.289.862 1.43 1.428 3.71l.27 1.086c.611 2.46.917 3.689 1.54 3.965.249.11.521.135.783.073.656-.157 1.142-1.313 2.114-3.625.178-.422.267-.634.416-.775a.891.891 0 0 1 .208-.147c.179-.091.389-.091.81-.091H22" />
  </svg>
)
export default SvgComponent
