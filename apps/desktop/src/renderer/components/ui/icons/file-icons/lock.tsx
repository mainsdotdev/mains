import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_lock"}</title>
    <path d="M10 14v-3.5a6 6 0 0 1 12 0V14" fill="none" stroke="#94A3B8" strokeWidth={3} />
    <rect x={6} y={13.5} width={20} height={15} rx={3.5} fill="#94A3B8" />
    <circle cx={16} cy={19.5} r={2.4} fill="#1F2937" />
    <rect x={14.8} y={20.5} width={2.4} height={4.5} rx={1.2} fill="#1F2937" />
  </svg>
)
export default SvgComponent
