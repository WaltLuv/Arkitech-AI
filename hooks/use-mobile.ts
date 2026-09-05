/**
 * Client hook that tracks whether the current viewport is below the mobile breakpoint.
 */
import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT

// There is no viewport on the server, so render the desktop layout first. This
// matches the previous behaviour, where state started undefined and the effect
// corrected it after mount.
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
