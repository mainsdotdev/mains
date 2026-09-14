import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_audio"}</title>
    <path
      fill="#22D3EE"
      d="M26 3v16.5a4.75 4.75 0 1 1-2.5-4.18V8.6L13 11v11.5a4.75 4.75 0 1 1-2.5-4.18V7z"
    />
  </svg>
)
export default SvgComponent
