import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fillRule="evenodd"
    strokeLinejoin="round"
    strokeMiterlimit={2}
    clipRule="evenodd"
    viewBox="0 0 1000 1000"
    {...props}
  >
    <linearGradient
      id="a"
      x1={0}
      x2={1}
      y1={0}
      y2={0}
      gradientTransform="matrix(755.939 0 0 1000 122.03 499.97)"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset={0} stopColor="#f0a" />
      <stop offset={1} stopColor="#8c50ff" />
    </linearGradient>
    <path fill="#fff" d="M309.906 170.343h355.43v653.648h-355.43z" />
    <path
      fill="url(#a)"
      fillRule="nonzero"
      d="M122.03 465.44c0 246.666 157.434 456.53 377.69 534.53 109.84-38.788 204.467-110.833 271.395-203.758C838.467 703.015 877.97 588.909 877.97 465.44V136.379L499.856-.03 122.167 136.379V465.44zm312.186-253.758H609.56l-53.716 182.864h95.491L390.304 788.121l61.958-285.742H348.529z"
    />
  </svg>
)
export default SvgComponent
