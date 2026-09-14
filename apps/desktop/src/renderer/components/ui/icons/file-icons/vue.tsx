import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_vue"}</title>
    <path fill="#41B883" d="M2 5h6l8 13.8L24 5h6L16 29z" />
    <path fill="#35495E" d="M9.5 5h4.6L16 8.3 17.9 5h4.6L16 16z" />
  </svg>
)
export default SvgComponent
