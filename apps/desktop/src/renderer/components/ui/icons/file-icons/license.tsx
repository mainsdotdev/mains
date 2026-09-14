import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_license"}</title>
    <path fill="#FCD34D" d="M6 2h20a1 1 0 0 1 1 1v21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <path fill="#A16207" opacity={0.55} d="M9 7.5h14v2H9zm0 4.6h14v2H9zm0 4.6h8v2H9z" />
    <path fill="#CA8A04" d="m18.2 24.4-1 6.6 4.3-2.4 4.3 2.4-1-6.6z" />
    <circle cx={21.5} cy={22.5} r={6} fill="#EAB308" stroke="#FEF3C7" strokeWidth={1.3} />
  </svg>
)
export default SvgComponent
