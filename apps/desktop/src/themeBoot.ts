/**
 * Each theme's board colour and mode. index.html is painted before the editor's bundle runs, and the
 * Vite config can't import the editor's TypeScript, so the table is repeated here; platform's
 * themeBoot test keeps it equal to the editor's themes.
 */
export const THEME_BOARDS: Readonly<Record<string, readonly [board: string, mode: "light" | "dark"]>> = {
  whiteboard: ["#FBFBFA", "light"],
  blackboard: ["#1F2D27", "dark"],
  graphite: ["#16171A", "dark"],
  blueprint: ["#0F3460", "dark"],
  kraft: ["#D8C29D", "light"],
  legalpad: ["#FFF4B8", "light"],
  mint: ["#EEF6F1", "light"],
  midnight: ["#0E1424", "dark"],
  sakura: ["#FFF5F7", "light"],
  contrast: ["#FFFFFF", "light"],
  clay: ["#262624", "dark"],
}

/**
 * An inline <head> script that puts the saved theme's board on the page before its first paint, so a
 * dark theme never flashes the light default while the bundle loads. It resolves the theme the way the
 * editor's themePrefs does, from localStorage or, on desktop, the shell's newer boot copy of the prefs.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var themes=${JSON.stringify(THEME_BOARDS)},has=Object.prototype.hasOwnProperty,root=document.documentElement,local=null;
try{local=window.localStorage}catch(e){}
var boot=window.__NIB_BOOT__&&window.__NIB_BOOT__.prefs;
var rev=Number(local&&local.getItem("nib:prefs:rev"))||0;
var fromBoot=!!(boot&&boot.values&&boot.rev>rev);
function get(key){if(fromBoot&&has.call(boot.values,key))return boot.values[key];return local?local.getItem(key):null}
var raw=get("nib.theme"),id=typeof raw==="string"&&has.call(themes,raw)?raw:null,flag=get("nib.matchSystem");
var match=flag==="1"||flag==="true"?true:flag==="0"||flag==="false"?false:raw==="system";
if(match){var dark=false;try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}id=dark?"clay":"whiteboard"}else if(id===null)id="clay";
var theme=themes[id];
root.style.setProperty("--board",theme[0]);
root.style.backgroundColor="var(--board)";
root.style.colorScheme=theme[1];
root.setAttribute("data-nib-theme",id);
root.setAttribute("data-nib-mode",theme[1]);
var meta=document.querySelector('meta[name="theme-color"]');
if(meta)meta.setAttribute("content",theme[0]);
}catch(e){}})();`
