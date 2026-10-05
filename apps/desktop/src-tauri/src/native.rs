//! macOS document-window behaviour that Tauri does not expose: the edited dot in the close button, the
//! title-bar proxy icon, the system recent-documents list (which also fills the Dock menu) and a say in
//! whether the app may terminate (Dock > Quit, log out, shut down).

use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{ffi, sel, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSDocumentController, NSWindow};
    use objc2_foundation::{NSString, NSURL};
    use tauri::{AppHandle, Runtime, WebviewWindow};

    type TerminateHook = Box<dyn Fn() -> bool + Send + Sync>;

    static TERMINATE_HOOK: OnceLock<TerminateHook> = OnceLock::new();

    // NSApplicationTerminateReply
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    extern "C-unwind" fn application_should_terminate(
        _this: &AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        match TERMINATE_HOOK.get() {
            Some(wait) if wait() => TERMINATE_LATER,
            _ => TERMINATE_NOW,
        }
    }

    /// tao's app delegate has no applicationShouldTerminate:, so Dock > Quit and log out end the app
    /// without asking; this adds one. `wait` returns true to hold termination until reply_to_terminate.
    pub fn on_should_terminate(wait: impl Fn() -> bool + Send + Sync + 'static) -> bool {
        let Some(mtm) = MainThreadMarker::new() else {
            return false;
        };
        if TERMINATE_HOOK.set(Box::new(wait)).is_err() {
            return false;
        }
        let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else {
            return false;
        };
        // SAFETY: the function takes (self, _cmd, sender) and returns an NSUInteger, which is exactly
        // what the "Q@:@" type encoding declares; class_addMethod never replaces an existing method.
        let added = unsafe {
            let imp = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(application_should_terminate);
            ffi::class_addMethod(
                (class as *const AnyClass).cast_mut(),
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            )
            .as_bool()
        };
        if added {
            // AppKit may have looked up the delegate's optional methods when it was set, so set it again
            let app = NSApplication::sharedApplication(mtm);
            let delegate = app.delegate();
            app.setDelegate(None);
            app.setDelegate(delegate.as_deref());
        }
        added
    }

    pub fn reply_to_terminate<R: Runtime>(app: &AppHandle<R>, allow: bool) {
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            NSApplication::sharedApplication(mtm).replyToApplicationShouldTerminate(allow);
        });
    }

    fn with_ns_window<R: Runtime>(
        window: &WebviewWindow<R>,
        f: impl FnOnce(&NSWindow) + Send + 'static,
    ) {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(ptr) = target.ns_window() else {
                return;
            };
            // SAFETY: Tauri returns the live NSWindow behind this webview window, and AppKit is only
            // touched here on the main thread.
            let ns_window = unsafe { &*ptr.cast::<NSWindow>() };
            f(ns_window);
        });
    }

    pub fn set_document_edited<R: Runtime>(window: &WebviewWindow<R>, edited: bool) {
        with_ns_window(window, move |w| w.setDocumentEdited(edited));
    }

    pub fn set_represented_file<R: Runtime>(window: &WebviewWindow<R>, path: String) {
        with_ns_window(window, move |w| {
            w.setRepresentedFilename(&NSString::from_str(&path))
        });
    }

    pub fn note_recent_document<R: Runtime>(app: &AppHandle<R>, path: String) {
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
        });
    }

    pub fn clear_recent_documents<R: Runtime>(app: &AppHandle<R>) {
        let _ = app.run_on_main_thread(|| {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            // SAFETY: a nil sender is what the menu item passes too.
            unsafe {
                NSDocumentController::sharedDocumentController(mtm).clearRecentDocuments(None)
            };
        });
    }
}

pub fn set_document_edited<R: Runtime>(window: &WebviewWindow<R>, edited: bool) {
    #[cfg(target_os = "macos")]
    mac::set_document_edited(window, edited);
    #[cfg(not(target_os = "macos"))]
    let _ = (window, edited);
}

/// An empty path removes the proxy icon.
pub fn set_represented_file<R: Runtime>(window: &WebviewWindow<R>, path: &str) {
    #[cfg(target_os = "macos")]
    mac::set_represented_file(window, path.to_string());
    #[cfg(not(target_os = "macos"))]
    let _ = (window, path);
}

pub fn note_recent_document<R: Runtime>(app: &AppHandle<R>, path: &str) {
    #[cfg(target_os = "macos")]
    mac::note_recent_document(app, path.to_string());
    #[cfg(not(target_os = "macos"))]
    let _ = (app, path);
}

pub fn clear_recent_documents<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    mac::clear_recent_documents(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Must run on the main thread once the event loop exists (Tauri's setup). Returns false when the hook
/// could not be installed, in which case the app terminates without asking, as before.
pub fn on_should_terminate(wait: impl Fn() -> bool + Send + Sync + 'static) -> bool {
    #[cfg(target_os = "macos")]
    return mac::on_should_terminate(wait);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = wait;
        false
    }
}

/// GNOME's dark style lives in a setting GTK 3 doesn't read, so WebKitGTK would report a light
/// prefers-color-scheme; elsewhere the window follows the system by itself.
pub fn system_theme() -> Option<tauri::Theme> {
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.desktop.interface", "color-scheme"])
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .contains("prefer-dark")
            .then_some(tauri::Theme::Dark)
    }
    #[cfg(not(target_os = "linux"))]
    None
}

pub fn reply_to_terminate<R: Runtime>(app: &AppHandle<R>, allow: bool) {
    #[cfg(target_os = "macos")]
    mac::reply_to_terminate(app, allow);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, allow);
}
