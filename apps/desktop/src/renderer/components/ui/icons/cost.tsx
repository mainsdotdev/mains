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
      d="M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5ZM1.25 12C1.25 6.063 6.063 1.25 12 1.25S22.75 6.063 22.75 12 17.937 22.75 12 22.75 1.25 17.937 1.25 12ZM12 5.25a.75.75 0 0 1 .75.75v.317c1.63.292 3 1.517 3 3.183a.75.75 0 0 1-1.5 0c0-.844-.873-1.75-2.25-1.75s-2.25.906-2.25 1.75.873 1.75 2.25 1.75c1.937 0 3.75 1.333 3.75 3.25 0 1.666-1.37 2.891-3 3.183V18a.75.75 0 0 1-1.5 0v-.317c-1.63-.292-3-1.517-3-3.183a.75.75 0 0 1 1.5 0c0 .844.873 1.75 2.25 1.75s2.25-.906 2.25-1.75-.873-1.75-2.25-1.75c-1.937 0-3.75-1.333-3.75-3.25 0-1.666 1.37-2.891 3-3.183V6a.75.75 0 0 1 .75-.75Z"
      clipRule="evenodd"
    />
  </svg>
)
export default SvgComponent
