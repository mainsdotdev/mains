import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={768}
    height={714}
    fill="none"
    viewBox="0 0 768 714"

    {...props}
  >
    <path
      stroke="currentColor"
      strokeWidth={48}
      d="M307.5 24h153C618 24 744 146.684 744 300.04v113.921c0 105.157-85.5 205.934-130.5 232.223-22.5 17.527-47.72 8.763-45-26.289L589 355.711c3.74-48.198-29-78.869-63-78.869s-58.1 30.671-63 78.869l-29.5 290.473c-2.67 26.29-18 43.816-45 43.816h-9c-27 0-42.33-17.526-45-43.816L305 355.711c-4.9-48.198-29-78.869-63-78.869s-66.74 30.671-63 78.869l20.5 264.184c2.72 35.052-22.5 43.816-45 26.289C109.5 619.895 24 519.118 24 413.961V300.04C24 146.684 150 24 307.5 24Z"
    />
  </svg>
)
export default SvgComponent
