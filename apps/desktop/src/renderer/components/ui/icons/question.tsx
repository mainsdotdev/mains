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
    <path d="M12 20.5c7.133 0 10-4.03 10-9s-1.867-9-10-9c-7.867 0-10 4.03-10 9 0 2.071.37 3.98 1.372 5.5 1.26 2 .62 3.833-.372 4.5 1.615 0 2.702-.514 3.392-1.023.49-.362 1.115-.54 1.706-.396 1.109.272 2.401.419 3.902.419Z" />
    <path d="M10 9a2 2 0 1 1 3.363 1.463C12.757 11.028 12 11.672 12 12.5m.125 3.25H12m.25 0a.25.25 0 1 1-.5 0 .25.25 0 0 1 .5 0Z" />
  </svg>
)
export default SvgComponent
