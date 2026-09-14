import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_pdf"}</title>
    <path fill="#E5E7EB" d="M7 2h12l7 7v21a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <path fill="#9CA3AF" d="M19 2l7 7h-7z" />
    <rect x={3} y={15} width={22} height={10} rx={2} fill="#E5252A" />
    <text
      x={14}
      y={22.8}
      fontFamily="-apple-system, system-ui, sans-serif"
      fontSize={8.5}
      fontWeight={700}
      textAnchor="middle"
      fill="#fff"
    >
      {"PDF"}
    </text>
  </svg>
)
export default SvgComponent
