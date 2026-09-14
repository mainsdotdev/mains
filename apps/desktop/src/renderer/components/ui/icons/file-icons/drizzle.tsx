import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_drizzle"}</title>
    <g stroke="#C5F74F" strokeWidth={3.4} strokeLinecap="round">
      <path d="M7.5 12 4.5 19" />
      <path d="M15 12l-3 7" />
      <path d="M22.5 12l-3 7" />
      <path d="M11.5 21 9.5 26" />
      <path d="M19 21l-2 5" />
      <path d="M26.5 12l-3 7" />
    </g>
  </svg>
)
export default SvgComponent
