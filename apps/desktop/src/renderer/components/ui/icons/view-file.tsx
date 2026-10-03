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
    <path
      strokeLinecap="round"
      d="M8 7.001h8.75c2.107 0 3.16 0 3.917.506.327.219.609.5.827.828.486.726.505 1.726.506 3.668v1M12 7l-.633-1.267c-.525-1.05-1.005-2.107-2.168-2.543C8.69 3 8.108 3 6.944 3c-1.816 0-2.724 0-3.406.38A3 3 0 0 0 2.38 4.54C2 5.22 2 6.129 2 7.946v3.056c0 4.716 0 7.073 1.464 8.538C4.705 20.782 6.587 20.971 10 21"
    />
    <path
      strokeLinejoin="round"
      d="M17 21c2.761 0 5-3 5-3s-2.239-3-5-3-5 3-5 3 2.239 3 5 3Z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.125 18H17m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z"
    />
  </svg>
)
export default SvgComponent
