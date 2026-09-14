import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    preserveAspectRatio="xMidYMid"
    viewBox="0 0 256 256"
    {...props}
  >
    <defs>
      <linearGradient id="a" x1="50%" x2="50%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="#0091E6" />
        <stop offset="100%" stopColor="#0079BF" />
      </linearGradient>
    </defs>
    <rect width={256} height={256} fill="url(#a)" rx={25} />
    <rect width={78.08} height={112} x={144.64} y={33.28} fill="#FFF" rx={12} />
    <rect width={78.08} height={176} x={33.28} y={33.28} fill="#FFF" rx={12} />
  </svg>
)
export default SvgComponent
