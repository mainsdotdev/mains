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
      d="M3 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"
      opacity={0.1}
    />
    <path
      stroke="currentColor"
      strokeWidth={1.5}
      d="M3 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M6 15V9"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      d="M18 9v3.324C18 16.998 16.942 18 12.008 18H9"
    />
  </svg>
)
export default SvgComponent
