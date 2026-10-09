import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth={1}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M2.492 12c0-4.478 0-6.718 1.391-8.109C5.275 2.5 7.513 2.5 11.993 2.5c4.478 0 6.717 0 8.108 1.391 1.391 1.391 1.391 3.63 1.391 8.109 0 4.478 0 6.718-1.391 8.109S16.47 21.5 11.992 21.5c-4.478 0-6.717 0-8.109-1.391-1.39-1.392-1.39-3.63-1.39-8.109Z" />
    <path strokeLinecap="round" d="M6.992 7v10M10.992 7v10M13.992 7l3 10" />
  </svg>
)
export default SvgComponent
