import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_cpp"}</title>
    <path fill="#00599C" d="M16 2.5 28.5 9.5v13L16 29.5 3.5 22.5v-13z" />
    <text
      x={15}
      y={20.6}
      fontFamily="-apple-system, system-ui, sans-serif"
      fontSize={11.5}
      fontWeight={700}
      textAnchor="middle"
      fill="#fff"
    >
      {"C++"}
    </text>
  </svg>
)
export default SvgComponent
