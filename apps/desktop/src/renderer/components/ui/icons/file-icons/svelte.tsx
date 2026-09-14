import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_svelte"}</title>
    <rect x={2.5} y={2.5} width={27} height={27} rx={7} fill="#FF3E00" />
    <text
      x={16}
      y={23}
      fontFamily="-apple-system, system-ui, sans-serif"
      fontSize={19}
      fontWeight={700}
      fontStyle="italic"
      textAnchor="middle"
      fill="#fff"
    >
      {"S"}
    </text>
  </svg>
)
export default SvgComponent
