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
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      d="m14.162 18.488-.72.72a6.117 6.117 0 0 1-8.65-8.65l.72-.72M9.837 14.162l4.325-4.325M9.837 5.512l.721-.72a6.117 6.117 0 1 1 8.65 8.65l-.72.72"
    />
  </svg>
)
export default SvgComponent
