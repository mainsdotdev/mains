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
    <title>{"file_type_gitlab"}</title>
    <path
      d="m16 28.896 5.156-15.867H10.844L16 28.896z"
      style={{
        fill: "#e24329",
      }}
    />
    <path
      d="m16 28.896-5.156-15.867H3.619L16 28.896z"
      style={{
        fill: "#fc6d26",
      }}
    />
    <path
      d="m3.619 13.029-1.567 4.822a1.067 1.067 0 0 0 .388 1.193L16 28.9 3.619 13.029Z"
      style={{
        fill: "#fca326",
      }}
    />
    <path
      d="M3.619 13.029h7.225L7.739 3.473a.534.534 0 0 0-1.015 0l-3.105 9.556Z"
      style={{
        fill: "#e24329",
      }}
    />
    <path
      d="m16 28.896 5.156-15.867h7.225L16 28.896z"
      style={{
        fill: "#fc6d26",
      }}
    />
    <path
      d="m28.381 13.029 1.567 4.822a1.067 1.067 0 0 1-.388 1.193L16 28.9l12.381-15.871Z"
      style={{
        fill: "#fca326",
      }}
    />
    <path
      d="M28.381 13.029h-7.225l3.105-9.557a.534.534 0 0 1 1.015 0l3.105 9.557Z"
      style={{
        fill: "#e24329",
      }}
    />
  </svg>
)
export default SvgComponent
