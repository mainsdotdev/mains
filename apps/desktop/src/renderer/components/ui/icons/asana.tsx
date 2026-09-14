import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={22}
    fill="none"
    {...props}
  >
    <path
      fill="#F06A6A"
      d="M18.63 11.605a5.159 5.159 0 1 0 0 10.317 5.159 5.159 0 0 0 0-10.317Zm-13.4.001a5.159 5.159 0 1 0-.143 10.316 5.159 5.159 0 0 0 .143-10.316Zm11.858-6.448a5.158 5.158 0 1 1-10.316 0 5.158 5.158 0 0 1 10.316 0Z"
    />
  </svg>
)
export default SvgComponent
