import { useState } from "react";
import { LazyMotion, m, AnimatePresence, domAnimation, MotionConfig } from "motion/react";

interface AnimatedTitleProps {
  title: string;
  className?: string;
}

export function AnimatedTitle({ title, className = "" }: AnimatedTitleProps) {
  const [initialTitle] = useState(() => title);
  const hasChanged = title !== initialTitle;

  if (!hasChanged) {
    return <span className={className}>{title}</span>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        <m.span
          key={title}
          className={className}
          style={{ display: "block" }}
          initial={{
            clipPath: "inset(0 100% 0 0)",
            filter: "blur(6px)",
            opacity: 0,
          }}
          animate={{
            clipPath: "inset(0 0% 0 0)",
            filter: "blur(0px)",
            opacity: 1,
          }}
          exit={{
            clipPath: "inset(0 0 0 100%)",
            filter: "blur(6px)",
            opacity: 0,
          }}
          transition={{
            duration: 0.15,
            ease: [0.4, 0, 0.2, 1],
          }}
        >
          {title}
        </m.span>
      </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}
