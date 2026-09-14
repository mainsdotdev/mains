import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Finder"
    viewBox="0 0 512 512"
    {...props}
  >
    <rect width={512} height={512} fill="url(#finderBg)" rx="15%" />
    <defs>
      <linearGradient id="finderBg" x2={0} y1="100%">
        <stop offset={0} stopColor="#1e73f2" />
        <stop offset={1} stopColor="#19d3fd" />
      </linearGradient>
      <linearGradient id="finderFace" x2={0} y1="100%">
        <stop offset={0} stopColor="#dbe9f4" />
        <stop offset={1} stopColor="#f7f6f6" />
      </linearGradient>
    </defs>
    <path
      fill="url(#finderFace)"
      d="M435.2 0H274.4c-21.2 49.2-59.2 129.6-60.8 283.4a9.9 9.9 0 0 0 10 10.1h58.7a9.9 9.9 0 0 1 9.9 10.2A933.3 933.3 0 0 0 311.3 512h123.9a76.8 76.8 0 0 0 76.8-76.8V76.8A76.8 76.8 0 0 0 435.2 0z"
    />
    <path
      fill="none"
      stroke="#000"
      strokeLinecap="round"
      strokeWidth={20}
      d="M371 149v34m-229-34v34m263.4 147.2a215.2 215.2 0 0 1-298.8 0"
    />
  </svg>
)
export default SvgComponent
