import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={800}
    height={800}
    viewBox="0 0 32 32"
    {...props}
  >
    <title>{"file_type_pnpm"}</title>
    <path
      d="M30 10.75h-8.749V2H30ZM20.374 10.75h-8.75V2h8.75ZM10.749 10.75H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z"
      style={{
        fill: "#f9ad00",
      }}
    />
    <path
      d="M20.374 20.375h-8.75v-8.75h8.75ZM20.374 30h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30ZM10.749 30H2v-8.75h8.749Z"
      style={{
        fill: "#fff",
      }}
    />
  </svg>
)
export default SvgComponent
