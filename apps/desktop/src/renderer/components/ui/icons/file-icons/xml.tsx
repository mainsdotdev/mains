import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_xml"}</title>
    <path
      d="M11 8 3 16l8 8M21 8l8 8-8 8"
      fill="none"
      stroke="#E37933"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18.5 5.5 13.5 26.5"
      stroke="#E37933"
      strokeWidth={2.6}
      strokeLinecap="round"
      opacity={0.7}
    />
  </svg>
)
export default SvgComponent
