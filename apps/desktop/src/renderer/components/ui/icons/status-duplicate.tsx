import { SVGProps, useId } from "react";

const StatusDuplicate = (props: SVGProps<SVGSVGElement>) => {
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
            d="m3.75 10.25 4.25-4.25m0 4 4.25-4.25"
            stroke="black"
            strokeLinecap="round"
            strokeWidth={2}
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

export default StatusDuplicate;
