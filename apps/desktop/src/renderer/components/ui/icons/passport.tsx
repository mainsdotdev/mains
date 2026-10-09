import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12.95 22c2.645 0 3.967 0 4.917-.756.95-.757 1.252-2.051 1.858-4.64l1.917-8.197c.335-1.433.503-2.15.199-2.67C21.288 4.796 19.879 5 18.959 5"
    />
    <path d="M2 9c0-3.3 0-4.95 1.025-5.975C4.05 2 5.7 2 9 2h3c3.3 0 4.95 0 5.975 1.025C19 4.05 19 5.7 19 9v6c0 3.3 0 4.95-1.025 5.975C16.95 22 15.3 22 12 22H9c-3.3 0-4.95 0-5.975-1.025C2 19.95 2 18.3 2 15V9Z" />
    <path d="M10.5 6a4 4 0 0 1 0 8m0-8a4 4 0 1 0 0 8m0-8C9.672 6 9 7.79 9 10s.672 4 1.5 4m0-8c.828 0 1.5 1.79 1.5 4s-.672 4-1.5 4" />
    <path strokeLinecap="round" d="M7 17h7" />
  </svg>
)
export default SvgComponent
