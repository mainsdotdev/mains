import type { SVGProps } from "react"

const SvgComponent = ({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={16}
    height={16}
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    {filled ? (
      <>
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11 2a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6.25 11A4.75 4.75 0 0 1 11 6.25a.75.75 0 0 1 0 1.5A3.25 3.25 0 0 0 7.75 11a.75.75 0 0 1-1.5 0Z"
        />
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth={2.5}
          d="m17.5 17.5 3.5 3.5"
        />
      </>
    ) : (
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16.672 16.641 21 21m-2-10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
      />
    )}
  </svg>
)
export default SvgComponent
