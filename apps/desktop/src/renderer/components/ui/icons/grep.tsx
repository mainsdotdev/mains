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
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M13 21h-1c-4.714 0-7.071 0-8.536-1.465C2 18.072 2 15.714 2 11V7.944c0-1.816 0-2.724.38-3.406A3 3 0 0 1 3.538 3.38C4.22 3 5.128 3 6.944 3 8.108 3 8.69 3 9.2 3.191c1.163.436 1.643 1.493 2.168 2.542L12 7M8 7h8.75c2.107 0 3.16 0 3.917.506a3 3 0 0 1 .827.827C21.98 9.06 22 10.06 22 12" />
    <path
      strokeLinejoin="round"
      d="m22 21-2.147-2.147m0 0a3.434 3.434 0 0 0 1.004-2.424 3.429 3.429 0 1 0-1.004 2.424Z"
    />
  </svg>
)
export default SvgComponent
