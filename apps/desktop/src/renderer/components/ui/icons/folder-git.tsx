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
    <path d="M8 6.501h8.75c2.107 0 3.16 0 3.917.506a3 3 0 0 1 .827.828c.506.757.506 1.81.506 3.918v.75M12 6.5l-.633-1.267c-.525-1.05-1.005-2.107-2.168-2.543C8.69 2.5 8.108 2.5 6.944 2.5c-1.816 0-2.724 0-3.406.38A3 3 0 0 0 2.38 4.04C2 4.72 2 5.629 2 7.446v3.056c0 4.716 0 7.073 1.464 8.538C4.705 20.282 6.587 20.471 10 20.5" />
    <circle cx={14} cy={12.5} r={2} />
    <circle cx={20} cy={18.5} r={2} />
    <path d="M18 18.5a4 4 0 0 1-4-4M14 14.5v7" />
  </svg>
)
export default SvgComponent
