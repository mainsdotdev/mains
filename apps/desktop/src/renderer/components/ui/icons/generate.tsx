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
    <path d="M3.513 9.487C4.025 10 4.85 10 6.5 10c1.65 0 2.475 0 2.987-.513C10 8.975 10 8.15 10 6.5c0-1.65 0-2.475-.513-2.987C8.975 3 8.15 3 6.5 3c-1.65 0-2.475 0-2.987.513C3 4.025 3 4.85 3 6.5c0 1.65 0 2.475.513 2.987ZM3.513 20.487C4.025 21 4.85 21 6.5 21c1.65 0 2.475 0 2.987-.513C10 19.975 10 19.15 10 17.5c0-1.65 0-2.475-.513-2.987C8.975 14 8.15 14 6.5 14c-1.65 0-2.475 0-2.987.513C3 15.025 3 15.85 3 17.5c0 1.65 0 2.475.513 2.987ZM15 4h6M15 15h6M15 9h6M15 20h6" />
  </svg>
)
export default SvgComponent
