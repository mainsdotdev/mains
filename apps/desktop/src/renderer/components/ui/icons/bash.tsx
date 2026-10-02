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
    <path d="m7 7 1.227 1.057C8.742 8.502 9 8.724 9 9c0 .276-.258.498-.773.943L7 11M11 11h3" />
    <path d="M12 21c3.75 0 5.625 0 6.939-.955a5 5 0 0 0 1.106-1.106C21 17.625 21 15.749 21 12c0-3.75 0-5.625-.955-6.939a5 5 0 0 0-1.106-1.106C17.625 3 15.749 3 12 3c-3.75 0-5.625 0-6.939.955A5 5 0 0 0 3.955 5.06C3 6.375 3 8.251 3 12c0 3.75 0 5.625.955 6.939a5 5 0 0 0 1.106 1.106C6.375 21 8.251 21 12 21Z" />
  </svg>
)
export default SvgComponent
