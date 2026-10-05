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
    <path d="M8 7h4m0 0h4.75c2.107 0 3.16 0 3.917.506a3 3 0 0 1 .827.827C22 9.09 22 10.143 22 12.25c0 3.511 0 5.267-.843 6.528a4.998 4.998 0 0 1-1.38 1.38C18.518 21 16.762 21 13.25 21H12c-4.714 0-7.071 0-8.536-1.465-.53-.53-.814-1.32-.957-2.137-.23-1.314-.346-1.97.254-2.684C3.36 14 4.21 14 5.91 14H11m1-7-.633-1.267c-.525-1.05-1.005-2.106-2.168-2.542C8.69 3 8.108 3 6.944 3c-1.816 0-2.724 0-3.406.38A3 3 0 0 0 2.38 4.538C2 5.22 2 6.128 2 7.944L2.02 10M9 17s3-2.21 3-3-3-3-3-3" />
  </svg>
)
export default SvgComponent
