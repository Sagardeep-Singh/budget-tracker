/**
 * The single `lg` breakpoint the responsive work uses, readable from JS.
 *
 * Mobile-only overlays are shown/hidden with `lg:hidden` wrappers, but CSS
 * visibility doesn't stop a mounted component's effects — a hidden mobile
 * sheet would still lock body scroll and bind a focus trap on desktop. Those
 * effects guard on this instead.
 */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

export const isDesktopViewport = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
