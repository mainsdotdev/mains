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
    <path d="M5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 13v8M19 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 6h2c1.87 0 2.804 0 3.5.402A3 3 0 0 1 18.598 7.5C19 8.196 19 9.13 19 11m-4-8s-3 2.21-3 3 3 3 3 3" />
  </svg>
)
export default SvgComponent
