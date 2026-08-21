"use client";

import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Entrance primitives.
 *
 * Deliberately restrained: a short rise and a fade, no scale, no blur. The
 * canvas underneath is already doing something dramatic on every scroll tick,
 * and DOM content that also flies in turns the page into noise. Everything
 * fires once (`viewport.once`) — content that re-animates on the way back up
 * makes a long page feel unstable.
 */
const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={rise}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-12% 0px -12% 0px" }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/** Staggers direct children that use `RevealItem`. */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      variants={{ show: { transition: { staggerChildren: stagger } } }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={rise}>
      {children}
    </motion.div>
  );
}

/**
 * Word-by-word reveal for headlines. Split on spaces rather than characters:
 * per-character staggers on a 60px headline read as a gimmick, and they wreck
 * text selection and screen-reader output.
 */
export function RevealWords({
  text,
  className,
  wordClassName,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
}) {
  const words = text.split(" ");
  return (
    <motion.span
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-15% 0px" }}
      variants={{ show: { transition: { staggerChildren: 0.045 } } }}
    >
      {words.map((word, i) => (
        // The mask box is the word's line box, which at the display line-height
        // used on this page (0.87) is shorter than the glyphs themselves — caps
        // get sliced off at the bottom. The padding gives the clip region the
        // missing room and the equal negative margin takes it back out of the
        // layout, so the mask contains the glyph without opening up the leading.
        <span
          key={i}
          className="inline-block overflow-hidden align-bottom pb-[0.18em] -mb-[0.18em]"
        >
          <motion.span
            className={`inline-block ${wordClassName ?? ""}`}
            variants={{
              hidden: { y: "110%" },
              show: { y: "0%", transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}
