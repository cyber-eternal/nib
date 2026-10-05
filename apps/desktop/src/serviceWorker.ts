/** Replaced at build time: true only for the web build (see vite.config.ts). */
declare const __NIB_PWA__: boolean | undefined

/** Offline support for the web build. The desktop app loads from its bundle and dev must never be cached. */
export const registerServiceWorker = (): void => {
  if (typeof __NIB_PWA__ === "undefined" || !__NIB_PWA__) return
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  const register = () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((e) => console.warn("Nib will not work offline in this browser", e))
  }
  if (document.readyState === "complete") register()
  else window.addEventListener("load", register, { once: true })
}
