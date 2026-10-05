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
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"

  >
    <path
      strokeLinejoin="round"
      d="M11.992 8v4M12.117 15.75h-.125m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z"
    />
    <path d="M20.992 11.184V8.28c0-1.64 0-2.46-.404-2.995-.404-.535-1.318-.794-3.145-1.314a24.574 24.574 0 0 1-3.229-1.173C13.016 2.266 12.416 2 11.992 2c-.424 0-1.023.266-2.222.798-.88.39-1.98.818-3.228 1.173-1.828.52-2.742.78-3.146 1.314-.404.535-.404 1.355-.404 2.995v2.904c0 5.625 5.063 9 7.594 10.336.607.32.91.48 1.406.48.496 0 .8-.16 1.406-.48 2.531-1.336 7.594-4.711 7.594-10.336Z" />
  </svg>
)
export default SvgComponent
