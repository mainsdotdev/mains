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
    <path d="M3 4v10c0 2.828 0 4.243.879 5.121C4.757 20 6.172 20 9 20h12" />
    <path d="m6 14 3.25-3.25c.644-.644.966-.966 1.343-1.072a1.5 1.5 0 0 1 .814 0c.377.106.699.428 1.343 1.072.644.644.966.966 1.343 1.072.266.076.548.076.814 0 .377-.106.699-.428 1.343-1.072L20 7" />
  </svg>
)
export default SvgComponent
