import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_vitest"}</title>
    <path
      fill="#729B1B"
      opacity={0.95}
      d="M16 30 2.2 7.4l12-4.6a1 1 0 0 1 .7 0l-.6 6.7 6.4-1.3-4.2 6.4 5.6-1.1L16 30z"
    />
    <path
      fill="#729B1B"
      d="M29.8 7.4 16 30l6.1-16.5-5.6 1.1 4.2-6.4-6.4 1.3.6-6.7a1 1 0 0 1 .8 0z"
    />
    <path fill="#FCC72B" d="M18.8 6.8 12 8.2l1.9 12.5 5-8.4-4 .8z" />
  </svg>
)
export default SvgComponent
