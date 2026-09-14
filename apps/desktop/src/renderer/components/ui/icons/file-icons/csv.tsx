import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_csv"}</title>
    <rect x={3} y={6} width={26} height={20} rx={3} fill="#21A366" />
    <path fill="#fff" opacity={0.92} d="M3 12h26v2.4H3zM3 18.4h26v2.4H3z" />
    <path fill="#fff" opacity={0.92} d="M11.5 12h2.4v14h-2.4zM18.1 12h2.4v14h-2.4z" />
  </svg>
)
export default SvgComponent
