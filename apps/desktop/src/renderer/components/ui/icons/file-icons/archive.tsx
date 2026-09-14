import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_archive"}</title>
    <path fill="#F59E0B" d="M4 9h24v18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path fill="#FBBF24" d="M3 4h26a1 1 0 0 1 1 1v4H2V5a1 1 0 0 1 1-1z" />
    <path fill="#78350F" opacity={0.75} d="M14.4 4h3.2v3h-3.2zm0 5h3.2v3h-3.2zm0 5h3.2v3h-3.2z" />
    <rect x={13.4} y={18} width={5.2} height={6.5} rx={1.4} fill="#78350F" opacity={0.75} />
  </svg>
)
export default SvgComponent
