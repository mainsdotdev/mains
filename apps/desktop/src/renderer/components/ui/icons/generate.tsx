import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path d="M13.5 4H11C6.757 4 4.636 4 3.318 5.318 2 6.636 2 8.758 2 13c0 4.243 0 6.364 1.318 7.682C4.636 22 6.758 22 11 22c4.243 0 6.364 0 7.682-1.318C20 19.364 20 17.242 20 13v-2.5M6 8l10 10M6 14l4 4M12 8l4 4M19.5 2.938V4.5m0 0v1.563m0-1.563h-1.25m1.25 0h1.25m1.25 0-1.084-.361a1.667 1.667 0 0 1-1.055-1.055L19.5 2l-.361 1.084a1.667 1.667 0 0 1-1.055 1.055L17 4.5l1.084.361c.498.166.889.557 1.055 1.055L19.5 7l.361-1.084a1.667 1.667 0 0 1 1.055-1.055L22 4.5Z" />
  </svg>
)
export default SvgComponent
