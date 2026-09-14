import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_font"}</title>
    <text
      x={16}
      y={24}
      fontFamily="Georgia, -apple-system, system-ui, serif"
      fontSize={21}
      fontWeight={700}
      textAnchor="middle"
      fill="#C084FC"
    >
      {"Aa"}
    </text>
  </svg>
)
export default SvgComponent
