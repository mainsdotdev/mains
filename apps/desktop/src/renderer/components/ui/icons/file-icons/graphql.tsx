import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_graphql"}</title>
    <g stroke="#E10098" strokeWidth={1.7} fill="none">
      <path d="M16 3.5 27 9.8v12.4L16 28.5 5 22.2V9.8z" />
      <path d="M6.2 21.5 16 4.5l9.8 17z" />
    </g>
    <g fill="#E10098">
      <circle cx={16} cy={4} r={2.8} />
      <circle cx={27} cy={10} r={2.8} />
      <circle cx={27} cy={22} r={2.8} />
      <circle cx={16} cy={28} r={2.8} />
      <circle cx={5} cy={22} r={2.8} />
      <circle cx={5} cy={10} r={2.8} />
    </g>
  </svg>
)
export default SvgComponent
