/** Shared OS accessibility preference for JavaScript motion. */
export function motionPreference() {
 return window.matchMedia('(prefers-reduced-motion: reduce)');
}
