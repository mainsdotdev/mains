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
    <path d="m6.219 11.618-2.907-.38c-.596-.077-.993-.654-.729-1.192C3.425 8.334 5.62 6.354 9.74 6.68m-3.521 4.937c1.055-1.764 2.353-3.614 3.52-4.937m-3.52 4.937 5.663 5.663M9.74 6.681c3.67-4.091 7.434-4.953 9.854-4.614a2.156 2.156 0 0 1 1.84 1.84c.338 2.419-.524 6.182-4.615 9.853m-4.937 3.521.38 2.907c.077.596.654.993 1.192.729 1.712-.842 3.692-3.037 3.365-7.157m-4.937 3.521c1.764-1.055 3.614-2.353 4.937-3.52" />
    <path d="M17.5 8a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM4 22l4-4m-4-1 1.5-1.5" />
  </svg>
)
export default SvgComponent
