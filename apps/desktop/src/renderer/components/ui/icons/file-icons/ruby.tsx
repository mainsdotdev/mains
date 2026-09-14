import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_ruby"}</title>
    <path fill="#9B111E" d="M16 30 4 12l4-8h16l4 8z" />
    <path fill="#CC342D" d="M16 30 8 4h16z" />
    <path fill="#E8544B" d="M8 4h16l4 8H4z" />
    <path fill="#B71C1C" opacity={0.35} d="M4 12h24L16 30z" />
  </svg>
)
export default SvgComponent
