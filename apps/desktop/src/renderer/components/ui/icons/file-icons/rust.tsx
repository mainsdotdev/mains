import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_rust"}</title>
    <circle
      cx={16}
      cy={16}
      r={12}
      fill="none"
      stroke="#DEA584"
      strokeWidth={4}
      strokeDasharray="2.6 2.2"
    />
    <circle cx={16} cy={16} r={8.4} fill="none" stroke="#DEA584" strokeWidth={2} />
    <text
      x={16}
      y={20.6}
      fontFamily="-apple-system, system-ui, sans-serif"
      fontSize={11.5}
      fontWeight={700}
      textAnchor="middle"
      fill="#DEA584"
    >
      {"R"}
    </text>
  </svg>
)
export default SvgComponent
