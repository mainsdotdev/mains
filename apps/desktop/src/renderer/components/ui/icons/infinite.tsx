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
      fillRule="evenodd"
      d="M6.75 9c-1.61 0-3 1.198-3 3s1.39 3 3 3c2.182 0 3.217-1.279 4.34-2.98C9.966 10.296 8.949 9 6.75 9Zm5.239 1.66C10.902 9.07 9.475 7.5 6.75 7.5c-2.37 0-4.5 1.802-4.5 4.5s2.13 4.5 4.5 4.5c2.703 0 4.14-1.545 5.235-3.12.434.627.924 1.25 1.52 1.765.94.814 2.13 1.355 3.745 1.355 2.37 0 4.5-1.802 4.5-4.5s-2.13-4.5-4.5-4.5c-2.725 0-4.165 1.57-5.261 3.16Zm.892 1.363c.51.778.998 1.462 1.606 1.988.684.592 1.529.989 2.763.989 1.61 0 3-1.198 3-3s-1.39-3-3-3c-2.2 0-3.234 1.3-4.37 3.023Z"
      clipRule="evenodd"
    />
  </svg>
)
export default SvgComponent
