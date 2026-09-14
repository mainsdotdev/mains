import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    viewBox="0 0 32 32"
    {...props}
  >
    <defs>
      <linearGradient
        id="a"
        x1={-66.775}
        x2={-66.775}
        y1={-171.703}
        y2={-171.817}
        gradientTransform="matrix(240 0 0 -240 16042 -41206)"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset={0} stopColor="#ec790f" />
        <stop offset={1} stopColor="#f51032" />
      </linearGradient>
    </defs>
    <title>{"file_type_favicon"}</title>
    <rect
      width={28}
      height={28}
      x={2}
      y={2}
      rx={1.75}
      ry={1.75}
      style={{
        fill: "url(#a)",
      }}
    />
    <path
      d="m16 22.625-6.489 3.408 1.239-7.218-5.25-5.111 7.255-1.054L16 6.083l3.245 6.567 7.255 1.054-5.25 5.111 1.239 7.218L16 22.625z"
      style={{
        fill: "#fff",
      }}
    />
  </svg>
)
export default SvgComponent
