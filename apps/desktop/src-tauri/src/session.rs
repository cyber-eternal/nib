//! The tabs open when Nib last quit or crashed. Only the shell reads and writes the file: a page that
//! could edit it would have the next launch grant it any file it named there.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

pub const SESSION_FILE: &str = "session.json";
const SESSION_VERSION: u32 = 1;
const MAX_TABS: usize = 256;
const MAX_SLOT: usize = 64;
const MIN_ZOOM: f64 = 0.1;
const MAX_ZOOM: f64 = 30.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub zoom: f64,
}

impl Viewport {
    pub fn is_sane(&self) -> bool {
        self.scroll_x.is_finite()
            && self.scroll_y.is_finite()
            && self.scroll_x.abs() < 1e9
            && self.scroll_y.abs() < 1e9
            && (MIN_ZOOM..=MAX_ZOOM).contains(&self.zoom)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TabEntry {
    /// Names the tab's recovery copy, recovery/<slot>.nibd.
    pub slot: String,
    pub path: Option<String>,
    pub viewport: Option<Viewport>,
}

/// The tabs in the order they were shown, and which one was in front.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub version: u32,
    pub tabs: Vec<TabEntry>,
    pub active: usize,
}

/// Recovery slots name files in the recovery folder, so they are plain names and nothing else.
pub fn is_slot_name(slot: &str) -> bool {
    !slot.is_empty()
        && slot.len() <= MAX_SLOT
        && slot
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_drawing_path(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.is_absolute() && crate::is_scene_file(p)
}

impl Session {
    /// Keeps only well-formed tabs: a plain slot named once, an absolute drawing path, a view the editor
    /// can show. Used for the file at launch and for every report from the page.
    pub fn cleaned(tabs: Vec<TabEntry>, active: usize) -> Self {
        let mut seen = HashSet::new();
        let tabs: Vec<TabEntry> = tabs
            .into_iter()
            .filter(|t| is_slot_name(&t.slot) && seen.insert(t.slot.clone()))
            .take(MAX_TABS)
            .map(|mut t| {
                t.path = t.path.filter(|p| is_drawing_path(p));
                t.viewport = t.viewport.filter(Viewport::is_sane);
                t
            })
            .collect();
        let active = active.min(tabs.len().saturating_sub(1));
        Self {
            version: SESSION_VERSION,
            tabs,
            active,
        }
    }

    /// Reads a session file leniently: a damaged file or tab costs that tab, never the launch.
    pub fn parse(text: &str) -> Self {
        serde_json::from_str::<Session>(text)
            .map(|s| Self::cleaned(s.tabs, s.active))
            .unwrap_or_default()
    }

    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(self).unwrap_or_default()
    }
}

/// A recovery copy found at launch, and whether it holds work that was never saved.
#[derive(Debug, Clone, PartialEq)]
pub struct RecoveryCopy {
    pub slot: String,
    pub unsaved: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedTab {
    pub slot: String,
    /// A drawing for the tab to open; None when it restores its recovery copy instead.
    pub open: Option<String>,
    /// The tab's document as the session knew it, granted again so the tab can save in place.
    #[serde(skip)]
    pub path: Option<String>,
    pub viewport: Option<Viewport>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RestorePlan {
    pub tabs: Vec<PlannedTab>,
    pub active: usize,
    /// Documents the session names that are gone.
    pub missing: Vec<String>,
    /// Recovery copies of saved drawings no tab will restore.
    pub stale: Vec<String>,
}

/// Which tabs to open at launch. With `reopen` the last session comes back; either way unsaved work left
/// in a recovery copy (a crash, a force quit) gets a tab, so turning the preference off never loses a
/// drawing.
pub fn plan_restore(
    session: &Session,
    reopen: bool,
    copies: &[RecoveryCopy],
    exists: impl Fn(&str) -> bool,
) -> RestorePlan {
    let mut plan = RestorePlan::default();
    let mut used = HashSet::new();
    let copy = |slot: &str| copies.iter().find(|c| c.slot == slot);
    for (i, entry) in session.tabs.iter().enumerate() {
        let found = copy(&entry.slot);
        if !reopen && !found.is_some_and(|c| c.unsaved) {
            continue;
        }
        let open = match (&entry.path, found) {
            (_, Some(_)) => None,
            (Some(path), None) if exists(path) => Some(path.clone()),
            (Some(path), None) => {
                plan.missing.push(path.clone());
                continue;
            }
            // an empty Untitled isn't worth a tab
            (None, None) => continue,
        };
        used.insert(entry.slot.clone());
        if i <= session.active {
            plan.active = plan.tabs.len();
        }
        plan.tabs.push(PlannedTab {
            slot: entry.slot.clone(),
            open,
            path: entry.path.clone(),
            viewport: entry.viewport,
        });
    }
    for c in copies {
        if used.contains(&c.slot) {
            continue;
        }
        if c.unsaved {
            plan.tabs.push(PlannedTab {
                slot: c.slot.clone(),
                open: None,
                path: None,
                viewport: None,
            });
        } else {
            plan.stale.push(c.slot.clone());
        }
    }
    plan
}

/// The one-line notice for documents a restore had to skip.
pub fn missing_notice(paths: &[String]) -> Option<String> {
    let names: Vec<String> = paths
        .iter()
        .map(|p| {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            format!("\u{201c}{name}\u{201d}")
        })
        .collect();
    match names.as_slice() {
        [] => None,
        [one] => Some(format!(
            "{one} was moved or deleted, so it wasn't reopened."
        )),
        many => Some(format!(
            "{} were moved or deleted, so they weren't reopened.",
            many.join(", ")
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(slot: &str, path: Option<&str>) -> TabEntry {
        TabEntry {
            slot: slot.into(),
            path: path.map(Into::into),
            viewport: None,
        }
    }

    fn copy(slot: &str, unsaved: bool) -> RecoveryCopy {
        RecoveryCopy {
            slot: slot.into(),
            unsaved,
        }
    }

    fn slots(plan: &RestorePlan) -> Vec<(&str, Option<&str>)> {
        plan.tabs
            .iter()
            .map(|t| (t.slot.as_str(), t.open.as_deref()))
            .collect()
    }

    #[test]
    fn a_session_round_trips_through_its_file() {
        let session = Session::cleaned(
            vec![
                TabEntry {
                    slot: "t1".into(),
                    path: Some("/Users/u/Plan.nibd".into()),
                    viewport: Some(Viewport {
                        scroll_x: -120.5,
                        scroll_y: 30.0,
                        zoom: 1.5,
                    }),
                },
                tab("t2", None),
            ],
            1,
        );
        let text = String::from_utf8(session.to_json()).unwrap();
        assert!(text.contains("\"scrollX\": -120.5"));
        assert_eq!(Session::parse(&text), session);
    }

    #[test]
    fn a_damaged_session_costs_only_what_is_damaged() {
        assert_eq!(Session::parse("not json"), Session::default());
        let text = r#"{"version":1,"active":9,"tabs":[
            {"slot":"../../etc","path":"/a/b.nibd"},
            {"slot":"ok-1","path":"relative.nibd"},
            {"slot":"ok-1","path":"/dup.nibd"},
            {"slot":"ok-2","path":"/Users/u/notes.txt","viewport":{"scrollX":0,"scrollY":0,"zoom":900}},
            {"slot":"ok-3","path":"/Users/u/Board.NIBD","viewport":{"scrollX":5,"scrollY":6,"zoom":2}}
        ]}"#;
        let parsed = Session::parse(text);
        let got: Vec<&str> = parsed.tabs.iter().map(|t| t.slot.as_str()).collect();
        assert_eq!(got, ["ok-1", "ok-2", "ok-3"]);
        assert_eq!(parsed.tabs[0].path, None);
        assert_eq!(parsed.tabs[1].path, None);
        assert_eq!(parsed.tabs[1].viewport, None);
        assert_eq!(parsed.tabs[2].path.as_deref(), Some("/Users/u/Board.NIBD"));
        assert_eq!(parsed.active, 2);
    }

    #[test]
    fn slot_names_are_plain() {
        for ok in ["current", "t1759750000000-3", "a_b"] {
            assert!(is_slot_name(ok), "{ok}");
        }
        for bad in ["", "../x", "a/b", ".hidden", "a b", &"x".repeat(65)] {
            assert!(!is_slot_name(bad), "{bad}");
        }
    }

    #[test]
    fn restore_reopens_files_and_recovers_unsaved_tabs() {
        let session = Session::cleaned(
            vec![
                tab("a", Some("/d/one.nibd")),
                tab("b", Some("/d/gone.nibd")),
                tab("c", None),
                tab("d", Some("/d/edited.nibd")),
                tab("e", None),
            ],
            3,
        );
        let copies = [copy("d", true), copy("e", true)];
        let plan = plan_restore(&session, true, &copies, |p| p != "/d/gone.nibd");
        assert_eq!(
            slots(&plan),
            [("a", Some("/d/one.nibd")), ("d", None), ("e", None)]
        );
        assert_eq!(plan.tabs[1].path.as_deref(), Some("/d/edited.nibd"));
        assert_eq!(plan.active, 1);
        assert_eq!(plan.missing, ["/d/gone.nibd"]);
        assert!(plan.stale.is_empty());
    }

    #[test]
    fn the_front_tab_falls_back_to_the_one_before_it_when_it_is_gone() {
        let session = Session::cleaned(
            vec![
                tab("a", Some("/d/one.nibd")),
                tab("b", Some("/d/two.nibd")),
                tab("c", Some("/d/gone.nibd")),
            ],
            2,
        );
        let plan = plan_restore(&session, true, &[], |p| p != "/d/gone.nibd");
        assert_eq!(plan.active, 1);
    }

    #[test]
    fn unsaved_work_comes_back_even_with_reopen_off() {
        let session = Session::cleaned(vec![tab("a", Some("/d/one.nibd")), tab("b", None)], 0);
        let copies = [copy("b", true), copy("orphan", true), copy("old", false)];
        let plan = plan_restore(&session, false, &copies, |_| true);
        assert_eq!(slots(&plan), [("b", None), ("orphan", None)]);
        assert_eq!(plan.stale, ["old"]);
        assert!(plan.missing.is_empty());
    }

    #[test]
    fn the_single_document_copy_of_earlier_versions_comes_back_as_a_tab() {
        let plan = plan_restore(&Session::default(), true, &[copy("current", true)], |_| {
            true
        });
        assert_eq!(slots(&plan), [("current", None)]);
    }

    #[test]
    fn missing_files_get_one_line() {
        assert_eq!(missing_notice(&[]), None);
        assert_eq!(
            missing_notice(&["/d/Plan.nibd".into()]).unwrap(),
            "\u{201c}Plan.nibd\u{201d} was moved or deleted, so it wasn't reopened."
        );
        let two = missing_notice(&["/d/a.nibd".into(), "/e/b.nibd".into()]).unwrap();
        assert!(two.contains("a.nibd\u{201d}, \u{201c}b.nibd"));
        assert!(!two.contains('\n'));
    }

    #[test]
    fn a_planned_tab_reaches_the_page_as_its_slot_file_and_view() {
        let planned = PlannedTab {
            slot: "t1".into(),
            open: None,
            path: Some("/d/secret.nibd".into()),
            viewport: Some(Viewport {
                scroll_x: 1.0,
                scroll_y: 2.0,
                zoom: 1.0,
            }),
        };
        let json = serde_json::to_string(&planned).unwrap();
        assert_eq!(
            json,
            r#"{"slot":"t1","open":null,"viewport":{"scrollX":1.0,"scrollY":2.0,"zoom":1.0}}"#
        );
    }
}
