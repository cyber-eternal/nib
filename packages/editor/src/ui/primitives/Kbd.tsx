import { formatChord, isMacPlatform } from "../../hooks/useShortcuts"

export interface KbdProps {
  /** A chord such as "Mod+Shift+E" or "R"; rendered as ⇧⌘E on macOS and Ctrl+Shift+E elsewhere. */
  chord: string
  /** Inline text without the key-cap border, for menu shortcut columns. */
  plain?: boolean
  isMac?: boolean
  className?: string
  /** Hide from assistive tech when the owner already carries aria-keyshortcuts. */
  decorative?: boolean
}

export const Kbd = ({ chord, plain, isMac, className, decorative }: KbdProps) => (
  <kbd
    className={["sc-kbd", plain ? "sc-kbd-plain" : "", className ?? ""].filter(Boolean).join(" ")}
    aria-hidden={decorative || undefined}
  >
    {formatChord(chord, isMac ?? isMacPlatform())}
  </kbd>
)
