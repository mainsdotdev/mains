import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="currentColor"
      d="M5.707 16.136a1 1 0 0 0 0 1.414l4.892 4.887a2 2 0 0 0 2.828 0l4.89-4.89a1 1 0 1 0-1.414-1.415l-4.185 4.186a1 1 0 0 1-1.415 0l-4.182-4.182a1 1 0 0 0-1.414 0ZM18.317 7.887a1 1 0 0 0 0-1.414l-4.892-4.888a2 2 0 0 0-2.828 0l-4.89 4.891A1 1 0 1 0 7.121 7.89l4.186-4.185a1 1 0 0 1 1.414 0l4.182 4.182a1 1 0 0 0 1.414 0Z"
    />
  </svg>
)
export default SvgComponent
