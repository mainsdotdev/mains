import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    style={{
      flex: "none",
      lineHeight: 1,
    }}
    viewBox="0 0 24 24"
    {...props}
  >
    <title>{"Z.ai"}</title>
    <path d="M12.105 2 9.927 4.953H.653L2.83 2h9.276zm11.149 17.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2 9.264 22H0L14.736 2H24z" />
  </svg>
)
export default SvgComponent
