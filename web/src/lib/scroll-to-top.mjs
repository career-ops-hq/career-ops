// Pure logic behind the floating "Back to Top" control, kept out of the React
// component so it can be unit-tested with `node --test` like the rest of
// src/lib. components/back-to-top.tsx is a thin shell over these two helpers.

/** How far the page must scroll before the control appears (px). */
export const BACK_TO_TOP_THRESHOLD = 400;

/**
 * Whether the control should be visible at the given scroll offset. The button
 * only earns its space once there's a meaningful distance to scroll back.
 *
 * @param {number} scrollY current vertical scroll offset (window.scrollY)
 * @param {number} [threshold] px to scroll before showing
 * @returns {boolean}
 */
export function shouldShowBackToTop(scrollY, threshold = BACK_TO_TOP_THRESHOLD) {
  return scrollY > threshold;
}

/**
 * Scroll behavior that honors the user's motion preference: an instant jump
 * when they've asked to reduce motion, a smooth glide otherwise.
 *
 * @param {boolean} prefersReducedMotion result of the reduce-motion media query
 * @returns {"auto" | "smooth"}
 */
export function scrollBehaviorFor(prefersReducedMotion) {
  return prefersReducedMotion ? "auto" : "smooth";
}
