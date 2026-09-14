import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_env"}</title>
    <circle cx={11.5} cy={11.5} r={6.6} fill="none" stroke="#FBBF24" strokeWidth={3.4} />
    <path
      d="m15.4 15.4 12 12"
      fill="none"
      stroke="#FBBF24"
      strokeWidth={3.4}
      strokeLinecap="round"
    />
    <path
      d="m21 22.4-3.2 3.2M24.2 25.6 21 28.8"
      fill="none"
      stroke="#FBBF24"
      strokeWidth={3.4}
      strokeLinecap="round"
    />
  </svg>
)
export default SvgComponent
