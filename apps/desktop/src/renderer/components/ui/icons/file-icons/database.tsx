import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_database"}</title>
    <path fill="#38BDF8" d="M16 3c6.1 0 11 1.8 11 4v18c0 2.2-4.9 4-11 4S5 27.2 5 25V7c0-2.2 4.9-4 11-4z" />
    <ellipse cx={16} cy={7} rx={11} ry={4} fill="#7DD3FC" />
    <path
      fill="none"
      stroke="#0B4A6F"
      strokeWidth={1.6}
      opacity={0.55}
      d="M5 13.5c0 2.2 4.9 4 11 4s11-1.8 11-4M5 20c0 2.2 4.9 4 11 4s11-1.8 11-4"
    />
  </svg>
)
export default SvgComponent
