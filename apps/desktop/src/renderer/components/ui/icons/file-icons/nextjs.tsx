import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_next"}</title>
    <circle cx={16} cy={16} r={13.5} fill="#0B0B0B" stroke="#E5E7EB" strokeWidth={1.2} />
    <path fill="#fff" d="M11 10h2.4l9.1 12.6-2 1.4z" />
    <path fill="#fff" d="M9.6 10H12v12H9.6zm10.4 0h2.4v8.4L20 15z" />
  </svg>
)
export default SvgComponent
