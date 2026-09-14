import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_docker"}</title>
    <g fill="#2496ED">
      <rect x={6.6} y={11} width={4.3} height={4.1} rx={0.5} />
      <rect x={11.6} y={11} width={4.3} height={4.1} rx={0.5} />
      <rect x={16.6} y={11} width={4.3} height={4.1} rx={0.5} />
      <rect x={11.6} y={6.3} width={4.3} height={4.1} rx={0.5} />
      <rect x={16.6} y={6.3} width={4.3} height={4.1} rx={0.5} />
      <rect x={16.6} y={1.6} width={4.3} height={4.1} rx={0.5} />
    </g>
    <path
      fill="#2496ED"
      d="M1.5 16.4h24.2c.5 2.4.1 4.6-1.3 6.4-2 2.6-5.4 3.9-10.1 3.9-5.1 0-8.9-1.8-11.2-5.4-1-1.5-1.5-3.1-1.6-4.9z"
    />
    <path
      fill="#2496ED"
      d="M25.4 14.8c1.7-1 3.7-1 5.6.1-.7 1.9-2.4 3-4.6 3.1a8 8 0 0 0-1-3.2z"
    />
  </svg>
)
export default SvgComponent
