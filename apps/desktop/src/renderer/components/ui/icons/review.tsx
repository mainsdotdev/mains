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
      d="M19 13.005v-2.344c0-.818 0-1.227-.152-1.595-.152-.368-.441-.657-1.02-1.235l-4.736-4.739c-.499-.499-.748-.748-1.058-.896a2 2 0 0 0-.197-.082C11.514 2 11.161 2 10.456 2c-3.245 0-4.868 0-5.967.886a4 4 0 0 0-.603.604C3 4.59 3 6.213 3 9.46v4.545c0 3.773 0 5.66 1.172 6.832C5.115 21.78 6.52 21.964 9 22m3-19.5V3c0 2.83 0 4.245.879 5.124.878.879 2.293.879 5.121.879h.5"
    />
    <path d="M16 22c2.761 0 5-3 5-3s-2.239-3-5-3-5 3-5 3 2.239 3 5 3Z" />
    <path strokeLinecap="round" d="M15.99 19H16" />
  </svg>
)
export default SvgComponent
