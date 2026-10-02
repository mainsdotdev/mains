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
    <path d="M3 6h6M16 9s-3-2.21-3-3 3-3 3-3m-2 3h1c2.828 0 4.243 0 5.121.879C21 7.757 21 9.172 21 12v9M3 13h13M3 20h13" />
  </svg>
)
export default SvgComponent
