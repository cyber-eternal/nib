use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

const MAX_KEY: usize = 128;
const MAX_VALUE: usize = 64 * 1024;
const MAX_ENTRIES: usize = 512;
/// The editor's REOPEN_TABS_PREF.
const REOPEN_TABS: &str = "nib.reopenTabs";

/// The durable copy of the webview's preferences. `None` marks a removed key, so a removal recorded here
/// still wins over an older value left in WebKit's localStorage.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrefsSnapshot {
    pub rev: u64,
    pub values: BTreeMap<String, Option<String>>,
}

impl PrefsSnapshot {
    /// Records one write from the webview; the limits keep a misbehaving page from filling the disk.
    pub fn apply(&mut self, key: String, value: Option<String>, rev: u64) -> Result<(), String> {
        if key.is_empty() || key.len() > MAX_KEY {
            return Err("preference keys must be 1 to 128 bytes long".into());
        }
        if value.as_ref().is_some_and(|v| v.len() > MAX_VALUE) {
            return Err(format!("the value of {key} is larger than 64 KB"));
        }
        if !self.values.contains_key(&key) && self.values.len() >= MAX_ENTRIES {
            return Err("too many preferences".into());
        }
        self.values.insert(key, value);
        self.rev = self.rev.max(rev);
        Ok(())
    }
}

impl PrefsSnapshot {
    /// Preferences > Reopen tabs on launch, on unless switched off.
    pub fn reopen_tabs(&self) -> bool {
        let value = self.values.get(REOPEN_TABS).cloned().flatten();
        !matches!(
            value.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
            Some("false" | "0" | "no" | "off")
        )
    }
}

/// Defines `window.__NIB_BOOT__` before any page script runs, so prefs and the tabs to restore can be
/// read synchronously.
pub fn boot_script(prefs: &PrefsSnapshot, updater: bool, session: &serde_json::Value) -> String {
    let boot = serde_json::json!({ "prefs": prefs, "updater": updater, "session": session });
    format!("Object.defineProperty(window,\"__NIB_BOOT__\",{{value:Object.freeze({boot})}});")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_values_removals_and_the_newest_revision() {
        let mut prefs = PrefsSnapshot::default();
        prefs
            .apply("nib.theme".into(), Some("dusk".into()), 3)
            .unwrap();
        prefs.apply("nib.grid".into(), None, 2).unwrap();
        assert_eq!(prefs.rev, 3);
        assert_eq!(prefs.values["nib.theme"].as_deref(), Some("dusk"));
        assert_eq!(prefs.values["nib.grid"], None);
    }

    #[test]
    fn refuses_oversized_entries() {
        let mut prefs = PrefsSnapshot::default();
        assert!(prefs.apply(String::new(), None, 1).is_err());
        assert!(prefs.apply("k".repeat(129), None, 1).is_err());
        assert!(prefs
            .apply("big".into(), Some("x".repeat(64 * 1024 + 1)), 1)
            .is_err());
        for i in 0..MAX_ENTRIES {
            prefs.apply(format!("k{i}"), None, 1).unwrap();
        }
        assert!(prefs.apply("one.more".into(), None, 1).is_err());
        assert!(prefs.apply("k0".into(), Some("v".into()), 2).is_ok());
    }

    #[test]
    fn boot_script_is_a_frozen_global() {
        let mut prefs = PrefsSnapshot::default();
        prefs
            .apply("nib.theme".into(), Some("a\"b</script>".into()), 1)
            .unwrap();
        let session = serde_json::json!({ "tabs": [{ "slot": "t1", "open": null }], "active": 0 });
        let script = boot_script(&prefs, false, &session);
        assert!(script.starts_with("Object.defineProperty(window,\"__NIB_BOOT__\""));
        assert!(script.contains(r#""nib.theme":"a\"b</script>""#));
        assert!(script.contains(r#""updater":false"#));
        assert!(script.contains(r#""tabs":[{"open":null,"slot":"t1"}]"#));
    }

    #[test]
    fn tabs_reopen_unless_switched_off() {
        let mut prefs = PrefsSnapshot::default();
        assert!(prefs.reopen_tabs());
        prefs
            .apply(REOPEN_TABS.into(), Some("false".into()), 1)
            .unwrap();
        assert!(!prefs.reopen_tabs());
        prefs
            .apply(REOPEN_TABS.into(), Some("true".into()), 2)
            .unwrap();
        assert!(prefs.reopen_tabs());
        prefs.apply(REOPEN_TABS.into(), None, 3).unwrap();
        assert!(prefs.reopen_tabs());
    }
}
