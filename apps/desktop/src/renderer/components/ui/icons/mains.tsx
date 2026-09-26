import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={720}
    height={666}
    fill="none"
    viewBox="0 0 720 666"
    {...props}
  >
    <path
      fill="currentColor"
      d="M283.5 0h153C594 0 720 122.684 720 276.04v113.921c0 105.157-85.5 205.934-130.5 232.223-22.5 17.527-49.5 8.763-45-26.289V306.711c0-48.198-31.5-78.869-67.5-78.869s-67.5 30.671-67.5 78.869v315.473c0 26.29-18 43.816-45 43.816h-9c-27 0-45-17.526-45-43.816V306.711c0-48.198-31.5-78.869-67.5-78.869s-67.5 30.671-67.5 78.869v289.184c4.5 35.052-22.5 43.816-45 26.289C85.5 595.895 0 495.118 0 389.961V276.04C0 122.684 126 0 283.5 0Z"
    />
  </svg>
)
export default SvgComponent
