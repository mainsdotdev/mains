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
      <style>{".cls-1{fill:#5f7cf9}.cls-3{fill:#4062ed}"}</style>
    </defs>
    <title />
    <g id="Image">
      <rect
        width={28}
        height={20}
        x={2}
        y={6}
        className="cls-1"
        rx={1}
        ry={1}
      />
      <path
        d="M30 16.58V25a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-.5l12.4-9.3a1 1 0 0 1 1.2 0l3.31 2.48 5.38-5.39a1 1 0 0 1 1.42 0Z"
        style={{
          fill: "#8c9eff",
        }}
      />
      <path
        d="M19 13a1 1 0 0 1-.38-.08 1.15 1.15 0 0 1-.33-.21 1 1 0 0 1-.21-1.09.9.9 0 0 1 .54-.54.93.93 0 0 1 .57-.06.6.6 0 0 1 .19.06.76.76 0 0 1 .18.09l.15.12a1.15 1.15 0 0 1 .21.33 1 1 0 0 1-.21 1.09 1.15 1.15 0 0 1-.33.21A1 1 0 0 1 19 13Z"
        className="cls-3"
      />
      <path
        d="M29 6H19v20h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"
        className="cls-3"
      />
      <path
        d="m19.71 11.29-.15-.12a.76.76 0 0 0-.18-.09.6.6 0 0 0-.19-.06H19v2a1 1 0 0 0 .38-.08 1.15 1.15 0 0 0 .33-.21 1 1 0 0 0 .21-1.09 1.15 1.15 0 0 0-.21-.35Z"
        style={{
          fill: "#2f58dd",
        }}
      />
      <path
        d="M24.29 12.29 19 17.59V26h10a1 1 0 0 0 1-1v-8.42l-4.29-4.29a1 1 0 0 0-1.42 0Z"
        className="cls-1"
      />
    </g>
  </svg>
)
export default SvgComponent
