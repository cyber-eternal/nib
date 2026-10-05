import { type MutableRefObject, useRef, useState } from "react"
import { chordToAria, isMacPlatform } from "../../hooks/useShortcuts"
import { Button, IconButton, MenuPopover, Toolbar, Tooltip } from "../primitives"
import { ShellIcons } from "./icons"
import { useMeasuredVar } from "./useMeasuredVar"
import "./shell.css"

export interface TopActionsProps {
  searchOpen: boolean
  libraryOpen: boolean
  themeOpen: boolean
  searchButtonRef: MutableRefObject<HTMLButtonElement | null>
  libraryButtonRef: MutableRefObject<HTMLButtonElement | null>
  themeButtonRef: MutableRefObject<HTMLButtonElement | null>
  onSearch(): void
  onLibrary(): void
  onTheme(): void
  onExport(): void
  /** Below 760px Search, Library and Theme fold into one ⋯ menu; Export stays. */
  narrow?: boolean
}

/** Top-right: three quiet icons and the one primary action, Export. */
export function TopActions({
  searchOpen,
  libraryOpen,
  themeOpen,
  searchButtonRef,
  libraryButtonRef,
  themeButtonRef,
  onSearch,
  onLibrary,
  onTheme,
  onExport,
  narrow,
}: TopActionsProps) {
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // the tab strip top-left takes the width these leave
  useMeasuredVar(root, "--top-actions-w")

  return (
    <div ref={root} className="shell-top-actions" data-zone="top">
      <Toolbar label="Board actions" className="shell-top-toolbar">
        {narrow ? (
          <>
            <IconButton
              ref={(el) => {
                moreRef.current = el
                // the panels anchor to whichever button is on screen
                searchButtonRef.current = el
                libraryButtonRef.current = el
                themeButtonRef.current = el
              }}
              label="More"
              icon={ShellIcons.more}
              tooltipSide="bottom"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-active={moreOpen || searchOpen || libraryOpen || themeOpen || undefined}
              onClick={() => setMoreOpen((v) => !v)}
            />
            <MenuPopover
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              anchor={moreRef}
              side="bottom"
              align="end"
              label="Board actions"
              items={[
                {
                  id: "search",
                  label: "Find on canvas",
                  shortcut: "Mod+F",
                  icon: ShellIcons.search,
                  onSelect: onSearch,
                },
                { id: "library", label: "Library", icon: ShellIcons.library, onSelect: onLibrary },
                { id: "theme", label: "Theme", icon: ShellIcons.theme, onSelect: onTheme },
              ]}
            />
          </>
        ) : (
          <>
            <IconButton
              ref={searchButtonRef}
              label="Find on canvas"
              shortcut="Mod+F"
              icon={ShellIcons.search}
              tooltipSide="bottom"
              aria-expanded={searchOpen}
              data-active={searchOpen || undefined}
              onClick={onSearch}
            />
            <IconButton
              ref={libraryButtonRef}
              label="Library"
              icon={ShellIcons.library}
              tooltipSide="bottom"
              aria-expanded={libraryOpen}
              data-active={libraryOpen || undefined}
              onClick={onLibrary}
            />
            <IconButton
              ref={themeButtonRef}
              label="Theme"
              icon={ShellIcons.theme}
              tooltipSide="bottom"
              aria-haspopup="dialog"
              aria-expanded={themeOpen}
              data-active={themeOpen || undefined}
              data-testid="theme-button"
              onClick={onTheme}
            />
          </>
        )}
        <Tooltip label="Export image" shortcut="Mod+Shift+E" side="bottom">
          <Button
            variant="primary"
            className="shell-export"
            icon={ShellIcons.export}
            aria-keyshortcuts={chordToAria("Mod+Shift+E", isMacPlatform())}
            data-testid="export-button"
            onClick={onExport}
          >
            Export
          </Button>
        </Tooltip>
      </Toolbar>
    </div>
  )
}
