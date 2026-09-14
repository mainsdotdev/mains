import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" {...props}>
    <title>{"file_type_video"}</title>
    <rect x={2} y={6} width={21} height={20} rx={3} fill="#A855F7" />
    <path fill="#E9D5FF" d="m11 12.5 6.5 3.5-6.5 3.5z" />
    <path fill="#7E22CE" d="M25 12.5 30 9v14l-5-3.5z" />
  </svg>
)
export default SvgComponent
