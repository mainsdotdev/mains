import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M21 8.5V6.6c0-1.697 0-2.546-.527-3.073C19.946 3 19.097 3 17.4 3h-1.9M20 4l-5.5 5.5M3 8.5V6.6c0-1.697 0-2.546.527-3.073C4.054 3 4.903 3 6.6 3h1.9M4 4l5.657 5.657c1.156 1.156 1.734 1.734 2.038 2.47.305.734.305 1.552.305 3.187V21" />
  </svg>
)
export default SvgComponent
