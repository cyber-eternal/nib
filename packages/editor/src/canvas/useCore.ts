import { useSyncExternalStore } from "react"
import { elementPicker } from "./elementPicker"

const subscribePicker = (cb: () => void) => elementPicker.subscribe(cb)
const pickerActive = () => elementPicker.active !== null

export const useElementPicking = (): boolean =>
  useSyncExternalStore(subscribePicker, pickerActive, pickerActive)
