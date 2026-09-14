import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_text"}</title>
    <path fill="#9CA3AF" d="M7 2h12l7 7v21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <path fill="#4B5563" d="M19 2l7 7h-7z" />
    <path fill="#1F2937" opacity={0.55} d="M10 14h12v2H10zm0 5h12v2H10zm0 5h8v2h-8z" />
  </svg>
)
export default SvgComponent
