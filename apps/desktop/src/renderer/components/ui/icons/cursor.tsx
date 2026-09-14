import * as React from "react"
import { SVGProps } from "react"

const CursorPath = () => (
  <path d="M22.106 5.68 12.5.135a.998.998 0 0 0-.998 0L1.893 5.68a.84.84 0 0 0-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 0 0 .998 0l9.608-5.547a.84.84 0 0 0 .42-.727V6.407a.84.84 0 0 0-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 0 0-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z" />
)

const CursorSolidPath = () => (
  <path d="M22.106 5.68 12.5.135a.998.998 0 0 0-.998 0L1.893 5.68a.84.84 0 0 0-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 0 0 .998 0l9.608-5.547a.84.84 0 0 0 .42-.727V6.407a.84.84 0 0 0-.42-.726z" />
)

const svgProps: SVGProps<SVGSVGElement> = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "1em",
  height: "1em",
  fill: "currentColor",
  fillRule: "evenodd",
  viewBox: "0 0 24 24",
}

const SvgComponent = ({ animate, className, ...props }: SVGProps<SVGSVGElement> & { animate?: boolean }) => {
  if (!animate) {
    return (
      <svg
        {...svgProps}
        className={className}
        style={{ flex: "none", lineHeight: 1 }}
        {...props}
      >
        <title>{"Cursor"}</title>
        <CursorPath />
      </svg>
    )
  }

  return (
    <span
      className="cube-rotate-3d inline-flex items-center justify-center"
      style={{
        perspective: 400,
        width: "1em",
        height: "1em",
      }}
    >
      <span
        className="animate-rotate-3d"
        style={{
          transformStyle: "preserve-3d",
          width: "1em",
          height: "1em",
          position: "relative",
          display: "inline-block",
        }}
      >
        {/* Front face */}
        <svg
          {...svgProps}
          className={className}
          style={{
            flex: "none",
            lineHeight: 1,
            backfaceVisibility: "hidden",
            position: "absolute",
            inset: 0,
          }}
          {...props}
        >
          <CursorPath />
        </svg>
        {/* Back face */}
        <svg
          {...svgProps}
          className={className}
          style={{
            flex: "none",
            lineHeight: 1,
            backfaceVisibility: "hidden",
            position: "absolute",
            inset: 0,
            transform: "rotate3d(1, 1, 0, 180deg)",
            opacity: 1,
          }}
          {...props}
        >
          <CursorSolidPath />
        </svg>
      </span>
    </span>
  )
}
export default SvgComponent
