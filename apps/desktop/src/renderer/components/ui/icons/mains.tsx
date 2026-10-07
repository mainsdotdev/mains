import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={720}
    height={674}
    fill="none"
    {...props}
    viewBox="0 0 720 674"
  >
    <path
      fill="currentColor"
      d="M126.667 57.286C200 177.378 270 230.752 360 230.752s160-53.374 233.333-173.466c13.334-20.015 30-23.35 43.334 0C690 130.676 720 224.08 720 337.5c0 113.42-30 206.824-83.333 280.214-13.334 23.351-30 20.015-43.334 0C520 497.622 450 444.248 360 444.248s-160 53.374-233.333 173.466c-13.334 20.015-30 23.351-43.334 0C30 544.324 0 450.92 0 337.5 0 224.08 30 130.676 83.333 57.286c13.334-23.35 30-20.015 43.334 0Z"
    />
  </svg>
)
export default SvgComponent
