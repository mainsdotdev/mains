import type { SVGProps } from "react"

const SvgComponent = ({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
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
    {filled ? (
      <path
        fill="currentColor"
        stroke="none"
        d="M1.276 11.25A10.75 10.75 0 0 1 12 1.25A4.75 10.75 0 0 0 7.262 11.25ZM8.758 11.25A3.25 10.75 0 0 1 15.242 11.25ZM16.738 11.25A4.75 10.75 0 0 0 12 1.25A10.75 10.75 0 0 1 22.724 11.25ZM1.276 12.75A10.75 10.75 0 0 0 12 22.75A4.75 10.75 0 0 1 7.262 12.75ZM8.758 12.75A3.25 10.75 0 0 0 15.242 12.75ZM16.738 12.75A4.75 10.75 0 0 1 12 22.75A10.75 10.75 0 0 0 22.724 12.75Z"
      />
    ) : (
      <>
        <circle cx={12} cy={12} r={10} />
        <ellipse cx={12} cy={12} rx={4} ry={10} />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12h20" />
      </>
    )}
  </svg>
)
export default SvgComponent
