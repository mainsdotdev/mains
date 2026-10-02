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
    <path d="M2.5 5.5c0-1.65 0-2.475.513-2.987C3.525 2 4.35 2 6 2c1.65 0 2.475 0 2.987.513C9.5 3.025 9.5 3.85 9.5 5.5c0 1.65 0 2.475-.513 2.987C8.475 9 7.65 9 6 9c-1.65 0-2.475 0-2.987-.513C2.5 7.975 2.5 7.15 2.5 5.5ZM3.657 15.657C4.76 14.552 5.314 14 6 14c.686 0 1.239.552 2.343 1.657C9.448 16.76 10 17.314 10 18c0 .686-.552 1.239-1.657 2.343C7.24 21.448 6.686 22 6 22c-.686 0-1.239-.552-2.343-1.657C2.552 19.24 2 18.686 2 18c0-.686.552-1.239 1.657-2.343Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9v5m4 4h5" />
    <path d="M15 18c0-1.65 0-2.475.513-2.987.512-.513 1.337-.513 2.987-.513 1.65 0 2.475 0 2.987.513C22 15.525 22 16.35 22 18c0 1.65 0 2.475-.513 2.987-.512.513-1.337.513-2.987.513-1.65 0-2.475 0-2.987-.513C15 20.475 15 19.65 15 18Z" />
  </svg>
)
export default SvgComponent
