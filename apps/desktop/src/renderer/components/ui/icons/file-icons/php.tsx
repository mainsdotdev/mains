import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_php"}</title>
    <ellipse cx={16} cy={16} rx={15} ry={8.5} fill="#777BB4" />
    <text
      x={16}
      y={19.8}
      fontFamily="-apple-system, system-ui, sans-serif"
      fontSize={10.5}
      fontWeight={700}
      fontStyle="italic"
      textAnchor="middle"
      fill="#fff"
    >
      {"php"}
    </text>
  </svg>
)
export default SvgComponent
