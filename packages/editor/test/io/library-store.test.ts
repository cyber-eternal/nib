import { createLibraryItem, newElement, parseLibrary, serializeLibrary } from "@nib/core"
import { describe, expect, test } from "vitest"
import {
  LIBRARY_FILE,
  LIBRARY_PREF_KEY,
  LibraryStore,
  libraryDragData,
  libraryItemsFromDrop,
} from "../../src/document/libraryStore"
import { createFakePlatform } from "../fakePlatform"

const item = (x = 0, name?: string) =>
  createLibraryItem([newElement("rectangle", { x, y: 0, width: 40, height: 30, index: "a0" })], {}, name)

const FILE = `/appdata/${LIBRARY_FILE}`

describe("library persistence", () => {
  test("on desktop the library lives in a file in the app data folder", async () => {
    const platform = createFakePlatform({ name: "tauri" })
    const store = new LibraryStore(platform)
    expect(await store.save([item(0, "Box")])).toBe(true)
    expect(platform.files.has(FILE)).toBe(true)
    expect(platform.prefsStore.has(LIBRARY_PREF_KEY)).toBe(false)
    const back = await new LibraryStore(platform).load()
    expect(back.map((i) => i.name)).toEqual(["Box"])
  })

  test("in the browser it lives in prefs, because app data there is per tab", async () => {
    const platform = createFakePlatform({ name: "browser" })
    const store = new LibraryStore(platform)
    await store.save([item(0, "Web")])
    expect(platform.files.size).toBe(0)
    expect(parseLibrary(platform.prefsStore.get(LIBRARY_PREF_KEY)!)[0]!.name).toBe("Web")
    expect((await new LibraryStore(platform).load())[0]!.name).toBe("Web")
  })

  test("an unreadable library is kept aside instead of being overwritten", async () => {
    const platform = createFakePlatform({ name: "tauri" })
    platform.files.set(FILE, "{ not json")
    const store = new LibraryStore(platform)
    expect(await store.load()).toEqual([])
    expect(store.lastError).toContain("kept aside")
    expect(platform.files.get("/appdata/library.unreadable.excalidrawlib")).toBe("{ not json")
  })

  test("a library file that can't be read at all is never overwritten", async () => {
    const platform = createFakePlatform({ name: "tauri" })
    platform.files.set(FILE, serializeLibrary([item(0, "Precious")]))
    platform.fs.readText = async () => {
      throw new Error("EACCES")
    }
    const store = new LibraryStore(platform)
    expect(await store.load()).toEqual([])
    expect(await store.save([item(5)])).toBe(false)
    expect(store.lastError).toContain("isn't being saved")
    expect(parseLibrary(platform.files.get(FILE)!)[0]!.name).toBe("Precious")
  })

  test("writes land in order, so a slow save can't overwrite a newer one", async () => {
    const platform = createFakePlatform({ name: "tauri" })
    const write = platform.fs.writeText
    let first = true
    platform.fs.writeText = async (path, contents) => {
      if (first) {
        first = false
        await new Promise((r) => setTimeout(r, 20))
      }
      return write(path, contents)
    }
    const store = new LibraryStore(platform)
    const a = store.save([item(0, "first")])
    const b = store.save([item(0, "second")])
    await Promise.all([a, b])
    expect(parseLibrary(platform.files.get(FILE)!)[0]!.name).toBe("second")
  })

  test("a host with a shared data folder keeps the library there, for every tab, and moves it out of prefs", async () => {
    const platform = createFakePlatform({ name: "browser", sharedDataDir: "/shared" })
    platform.prefsStore.set(LIBRARY_PREF_KEY, serializeLibrary([item(0, "From prefs")]))
    const store = new LibraryStore(platform)
    const items = await store.load()
    expect(items.map((i) => i.name)).toEqual(["From prefs"])
    expect(await store.save(items)).toBe(true)
    expect(parseLibrary(platform.files.get(`/shared/${LIBRARY_FILE}`)!)[0]!.name).toBe("From prefs")
    expect(platform.prefsStore.has(LIBRARY_PREF_KEY)).toBe(false)
    expect([...platform.files.keys()].some((k) => k.startsWith("/appdata"))).toBe(false)
  })

  test("a full store says so", async () => {
    const platform = createFakePlatform({ name: "browser", sharedDataDir: "/shared" })
    platform.fs.writeText = async () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" })
    }
    const store = new LibraryStore(platform)
    expect(await store.save([item()])).toBe(false)
    expect(store.lastError).toContain("storage is full")
  })

  test("a failed write is reported", async () => {
    const platform = createFakePlatform({ name: "tauri" })
    platform.fs.writeText = async () => {
      throw new Error("disk full")
    }
    const store = new LibraryStore(platform)
    expect(await store.save([item()])).toBe(false)
    expect(store.lastError).toContain("disk full")
  })
})

describe("dragging library items", () => {
  test("the drag payload carries the items exactly, names and all", () => {
    const items = [item(0, "One"), item(10, "Two")]
    const back = libraryItemsFromDrop(libraryDragData(items))
    expect(back.map((i) => [i.id, i.name])).toEqual(items.map((i) => [i.id, i.name]))
    expect(back[0]!.elements[0]!.type).toBe("rectangle")
    expect(libraryItemsFromDrop("not a library")).toEqual([])
  })
})
