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
      d="m6.2 14.9 1.3-2.7c.37-.73 1.13-1.15 1.95-1.15H20.1c1.44 0 2.5 1.35 2.15 2.75l-1.25 4.6c-.25 1.02-1.16 1.75-2.2 1.75H5c-1.24 0-2.25-1.01-2.25-2.25V6.95c0-1.24 1.01-2.25 2.25-2.25h2.72c.6 0 1.17.24 1.59.66l1.14 1.14c.42.42.99.66 1.59.66h6.96c1.24 0 2.25 1.01 2.25 2.25v1.6"
    />
  </svg>
)
export default SvgComponent
