import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      d="M2 19V7.549c0-1.444 0-2.166.243-2.733a3 3 0 0 1 1.573-1.573C4.383 3 5.098 3 6.55 3h.494a2 2 0 0 1 1.557.745L10.418 6m0 0H16c1.4 0 2.1 0 2.635.272a2.5 2.5 0 0 1 1.092 1.093C20 7.9 20 8.6 20 10v1m-9.582-5H7"
    />
    <path d="m3.158 15.514.298-.742c.734-1.827 1.101-2.74 1.866-3.256C6.088 11 7.076 11 9.052 11h8.06c2.688 0 4.033 0 4.63.879.598.879.098 2.121-.9 4.607l-.298.742c-.734 1.827-1.101 2.74-1.866 3.256-.766.516-1.754.516-3.73.516h-8.06c-2.688 0-4.033 0-4.63-.879-.598-.878-.098-2.121.9-4.607Z" />
  </svg>
)
export default SvgComponent
