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
    <path d="M16.736 14.639C15.915 11.43 13.383 9.08 12 8.198c.5-.533 1.966-.941 3.5-.533 1.534.408 3.5 2.128 3.5 4.789 0 1.026-.31 1.93-.706 2.648-.409.743-1.347.36-1.558-.464Z" />
    <path d="M16.616 3.5C12.923 3.5 12 6.5 12 8c2.867-1.553 5.92-1.297 7.862-.871.683.15 1.337-.344 1.082-.98C20.447 4.91 19.22 3.5 16.616 3.5ZM6.397 2.5c-1.791 0-2.872.805-3.322 1.628-.249.456.156.907.679.976C5.91 5.389 9.546 6.124 12 7.5c-.51-2-2.038-5-5.603-5ZM13 9.5c-.167 2.833-.5 7-2 12M9.5 12.5c-.5 1.667-2.1 5.8-4.5 9" />
    <path d="M8.5 6.5c2 0 3 1.118 3.5 1.677-4.075 1.367-5.825 3.476-6.875 5.723-.332.711-1.152.85-1.375.088a6.787 6.787 0 0 1-.25-1.898c0-3.913 3.5-5.59 5-5.59Z" />
  </svg>
)
export default SvgComponent
