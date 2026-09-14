import { SVGProps } from "react"

const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={16}
    height={16}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M2.75 17.05V6.95c0-1.24 1.01-2.25 2.25-2.25h2.72c.6 0 1.17.24 1.59.66l1.14 1.14c.42.42.99.66 1.59.66h6.96c1.24 0 2.25 1.01 2.25 2.25v7.64c0 1.24-1.01 2.25-2.25 2.25H5c-1.24 0-2.25-1.01-2.25-2.25Z"
    />
  </svg>
)
export default SvgComponent
