import type { EditorCore } from "@nib/core"
import { copyStyle, pasteStyle } from "../../document/clipboard"
import type { MenuSection } from "../primitives"
import { shortcutFor } from "./apply"
import { StyleIcons } from "./icons"
import type { StyleModel } from "./model"

export interface MoreActions {
  onRequestLink: () => void
  onTidy: () => void
  notify: (message: string) => void
}

/** What Lock says once the bar has gone with the selection. */
export const lockedNotice = (count: number): string =>
  count > 1 ? "Locked. Right-click any of them to unlock." : "Locked. Right-click it to unlock."

/** The ⋯ menu: frequent actions first, text-container actions when they apply, Delete set apart at the end. */
export const moreMenuSections = (
  core: EditorCore,
  model: StyleModel,
  actions: MoreActions,
): MenuSection[] => {
  const a = model.arrange
  const t = model.text
  const allLocked = a.locked === true
  const sections: MenuSection[] = [
    {
      id: "edit",
      items: [
        {
          id: "duplicate",
          label: "Duplicate",
          icon: StyleIcons.duplicate,
          shortcut: shortcutFor("edit.duplicate"),
          onSelect: () => core.duplicateSelected(),
        },
        {
          id: "copy-style",
          label: "Copy styles",
          icon: StyleIcons.copyStyle,
          shortcut: shortcutFor("edit.copyStyle"),
          onSelect: () => {
            if (copyStyle(core)) actions.notify("Copied styles.")
          },
        },
        {
          id: "paste-style",
          label: "Paste styles",
          icon: StyleIcons.pasteStyle,
          shortcut: shortcutFor("edit.pasteStyle"),
          onSelect: () => {
            if (!pasteStyle(core)) actions.notify("Copy styles from an element first.")
          },
        },
      ],
    },
    {
      id: "arrange",
      items: [
        ...(a.canGroup
          ? [
              {
                id: "group",
                label: "Group",
                icon: StyleIcons.group,
                shortcut: shortcutFor("arrange.group"),
                onSelect: () => core.group(),
              },
            ]
          : []),
        ...(a.canUngroup
          ? [
              {
                id: "ungroup",
                label: "Ungroup",
                icon: StyleIcons.ungroup,
                shortcut: shortcutFor("arrange.ungroup"),
                onSelect: () => core.ungroup(),
              },
            ]
          : []),
        {
          id: "flip-h",
          label: "Flip horizontal",
          icon: StyleIcons.flipH,
          shortcut: shortcutFor("arrange.flipH"),
          onSelect: () => core.flip("horizontal"),
        },
        {
          id: "flip-v",
          label: "Flip vertical",
          icon: StyleIcons.flipV,
          shortcut: shortcutFor("arrange.flipV"),
          onSelect: () => core.flip("vertical"),
        },
      ],
    },
    {
      id: "object",
      items: [
        {
          id: "link",
          label: a.hasLink ? "Edit link…" : "Add link…",
          icon: StyleIcons.link,
          shortcut: shortcutFor("edit.link"),
          onSelect: actions.onRequestLink,
        },
        {
          id: "lock",
          label: allLocked ? "Unlock" : "Lock",
          icon: allLocked ? StyleIcons.unlock : StyleIcons.lock,
          shortcut: shortcutFor("edit.lock"),
          onSelect: () => {
            if (allLocked && a.singleId) core.unlockElement(a.singleId)
            else {
              core.toggleLock()
              // locking clears the selection, and with it this bar: say where Unlock went
              if (!allLocked) actions.notify(lockedNotice(a.count))
            }
          },
        },
        ...(a.hasLinear
          ? [
              {
                id: "tidy",
                label: "Tidy up connectors",
                icon: StyleIcons.tidy,
                shortcut: shortcutFor("arrange.tidy"),
                onSelect: actions.onTidy,
              },
            ]
          : []),
      ],
    },
  ]
  const textItems = [
    ...(t.canBind
      ? [
          {
            id: "bind-text",
            label: "Bind text to shape",
            icon: StyleIcons.bindText,
            onSelect: () => {
              core.bindTextToContainer()
            },
          },
        ]
      : []),
    ...(t.canUnbind
      ? [
          {
            id: "unbind-text",
            label: "Unbind text",
            icon: StyleIcons.unbindText,
            onSelect: () => {
              core.unbindText()
            },
          },
        ]
      : []),
    ...(t.canWrap
      ? (
          [
            ["rectangle", "Wrap in rectangle", StyleIcons.wrapRectangle],
            ["diamond", "Wrap in diamond", StyleIcons.wrapDiamond],
            ["ellipse", "Wrap in ellipse", StyleIcons.wrapEllipse],
          ] as const
        ).map(([type, label, icon]) => ({
          id: `wrap-${type}`,
          label,
          icon,
          onSelect: () => {
            core.wrapTextInContainer(type)
          },
        }))
      : []),
  ]
  if (textItems.length > 0) sections.push({ id: "text", label: "Text", items: textItems })
  sections.push({
    id: "danger",
    isolated: true,
    items: [
      {
        id: "delete",
        label: "Delete",
        icon: StyleIcons.trash,
        shortcut: shortcutFor("edit.delete"),
        danger: true,
        onSelect: () => core.deleteSelected(),
      },
    ],
  })
  return sections.filter((s) => s.items.length > 0)
}
