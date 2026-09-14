import { SVGProps, useId } from "react";

const StatusDone = (props: SVGProps<SVGSVGElement>) => {
  const maskId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      {...props}
    >
      <defs>
        <mask id={maskId}>
          <circle cx={8} cy={8} r={8} fill="white" />
          <path
            d="m4.25 8.25 2.5 2.25 5-4.75"
            stroke="black"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.25}
          />
        </mask>
      </defs>
      <circle
        cx={8}
        cy={8}
        r={8}
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

export default StatusDone;
