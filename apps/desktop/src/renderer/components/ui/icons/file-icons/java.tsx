import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_java"}</title>
    <path
      fill="#5382A1"
      d="M14 3c2.6 2.2.4 4.3-.6 5.6-1.2 1.5-.9 2.9 1.7 4.6-2.9-1-4.7-2.6-4-4.3.5-1.3 3.4-3 2.9-5.9zm4.6 3.4c1.7 1.5.3 2.9-.4 3.8-.9 1.1-.7 2.1 1.1 3.3-2-.7-3.3-1.8-2.8-3 .4-1 2.4-2.1 2.1-4.1z"
    />
    <path fill="#EA2D2E" d="M9 15h14v5.5a4.5 4.5 0 0 1-4.5 4.5h-5A4.5 4.5 0 0 1 9 20.5z" />
    <path
      fill="#EA2D2E"
      d="M23 16.2h1.2a3.4 3.4 0 0 1 0 6.8H23v-2h1.2a1.4 1.4 0 0 0 0-2.8H23z"
    />
    <rect x={6} y={26.6} width={20} height={2.6} rx={1.3} fill="#5382A1" />
  </svg>
)
export default SvgComponent
