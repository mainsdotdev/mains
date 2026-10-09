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
    <path d="M15.5 14s3.5 2.578 3.5 3.5c0 .922-3.5 3.5-3.5 3.5" />
    <path d="M18.5 17.5h-6c-3.287 0-4.931 0-6.038-.908a4 4 0 0 1-.554-.554C5 14.93 5 13.288 5 10V3M9 6h10M9 10h7" />
  </svg>
)
export default SvgComponent
