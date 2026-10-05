import { NibApp } from "@nib/editor"
import { type Platform, createBrowserPlatform } from "@nib/platform"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerServiceWorker } from "./serviceWorker"
import { createTauriPlatform, isTauri } from "./tauriPlatform"

const platform: Platform = isTauri() ? createTauriPlatform() : createBrowserPlatform()
if (!isTauri()) registerServiceWorker()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NibApp platform={platform} />
  </StrictMode>,
)
