import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_yaml"}</title>
    <rect x={4} y={6} width={5} height={4} rx={1.4} fill="#EF4444" />
    <rect x={11} y={7} width={17} height={2.2} rx={1.1} fill="#EF4444" opacity={0.55} />
    <rect x={4} y={14} width={5} height={4} rx={1.4} fill="#EF4444" />
    <rect x={11} y={15} width={13} height={2.2} rx={1.1} fill="#EF4444" opacity={0.55} />
    <rect x={4} y={22} width={5} height={4} rx={1.4} fill="#EF4444" />
    <rect x={11} y={23} width={15} height={2.2} rx={1.1} fill="#EF4444" opacity={0.55} />
  </svg>
)
export default SvgComponent
