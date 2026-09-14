import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_shell"}</title>
    <rect x={2} y={5} width={28} height={22} rx={3.5} fill="#1F2937" />
    <path
      d="m8 13 4 3.5-4 3.5"
      fill="none"
      stroke="#4EAA25"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M15 21h8" stroke="#4EAA25" strokeWidth={2.4} strokeLinecap="round" />
  </svg>
)
export default SvgComponent
