import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    {...props}
  >
    <path fill="currentColor" d="M14.4 4.8H4.8v14.4h9.6V4.8ZM19.2 24H0V0h19.2v24Z" />
  </svg>
)
export default SvgComponent
