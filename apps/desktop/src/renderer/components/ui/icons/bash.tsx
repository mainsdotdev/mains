import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    fill="none"
    viewBox="0 0 800 800"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeWidth={60}
      d="M66 292c0-67.207 0-100.81 9.693-126.479 8.526-22.58 22.131-40.937 38.865-52.442C133.582 100 158.486 100 208.293 100h382.414c49.807 0 74.713 0 93.735 13.079 16.733 11.505 30.34 29.862 38.864 52.442C733 191.19 733 224.793 733 292v216c0 67.206 0 100.812-9.694 126.48-8.524 22.578-22.131 40.938-38.864 52.44C665.42 700 640.514 700 590.707 700H208.293c-49.807 0-74.711 0-93.735-13.08-16.734-11.502-30.339-29.862-38.865-52.44C66 608.812 66 575.206 66 508V292Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={60}
      d="m186.061 310.667 88.933 88.888-88.933 88.889"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={60}
      d="M363.482 488h222.334"
    />
  </svg>
)
export default SvgComponent
