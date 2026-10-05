import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    color="currentColor"
    {...props}
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.5 8.187c.104-2.1.415-3.41 1.347-4.34.93-.932 2.24-1.243 4.34-1.347M21.5 8.187c-.104-2.1-.415-3.41-1.347-4.34-.93-.932-2.24-1.243-4.34-1.347m0 19c2.1-.104 3.41-.415 4.34-1.347.932-.93 1.243-2.24 1.347-4.34M8.187 21.5c-2.1-.104-3.41-.415-4.34-1.347-.932-.93-1.243-2.24-1.347-4.34"
    />
    <path d="M19.635 11.318c.243.304.365.457.365.682 0 .225-.122.378-.365.682C18.542 14.05 15.751 17 12 17s-6.542-2.95-7.635-4.318C4.122 12.378 4 12.225 4 12c0-.225.122-.378.365-.682C5.458 9.95 8.249 7 12 7s6.542 2.95 7.635 4.318Z" />
    <path d="M14 12a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z" />
  </svg>
)
export default SvgComponent
