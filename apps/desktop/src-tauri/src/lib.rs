mod native;
mod prefs;
mod session;
mod updates;

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_fs::FsExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

use prefs::PrefsSnapshot;
use session::{RecoveryCopy, Session, TabEntry, SESSION_FILE};

const MAIN_WINDOW: &str = "main";
const OPEN_FILE_EVENT: &str = "open-file";
const GUARD_EVENT: &str = "nib://guard";
const QUIT_MENU_ID: &str = "app.quit";
// Linux and Windows menus have no working predefined Close Window or Full Screen items (menu.ts)
const CLOSE_MENU_ID: &str = "window.close";
const FULLSCREEN_MENU_ID: &str = "window.fullscreen";
const RECENT_FILE: &str = "recent-files.json";
const PREFS_FILE: &str = "prefs.json";
const RECOVERY_DIR: &str = "recovery";
const MAX_RECENT: usize = 10;
/// How long the webview has to acknowledge a close or quit before the shell stops waiting for it.
const GUARD_ACK_TIMEOUT: Duration = Duration::from_secs(4);
/// The window shows once its page has painted; a page that never finishes loading still gets shown.
const REVEAL_FALLBACK: Duration = Duration::from_secs(3);
const SCENE_EXTENSIONS: [&str; 2] = ["nibd", "excalidraw"];
// VISIBLE is left out: a window saved while the app was hidden would otherwise never be shown again
const WINDOW_STATE: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

#[derive(Default)]
struct OpenQueue {
    pending: Vec<String>,
    delivering: bool,
}

#[derive(Default)]
struct Shell {
    opens: Mutex<OpenQueue>,
    guard_ready: AtomicBool,
    guard_seq: AtomicU64,
    guard_acked: AtomicU64,
    /// AppKit is waiting for replyToApplicationShouldTerminate.
    terminate_pending: AtomicBool,
    recent: Mutex<Option<Vec<String>>>,
    prefs: Mutex<Option<PrefsSnapshot>>,
    revealed: AtomicBool,
    /// The session as last written, so an unchanged report doesn't touch the disk.
    session: Mutex<Option<Session>>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum GuardKind {
    Close,
    Quit,
    /// Dock > Quit, log out or shut down, which AppKit holds until the webview answers.
    Terminate,
}

#[derive(Clone, Serialize)]
struct GuardRequest {
    id: u64,
    kind: GuardKind,
}

fn is_scene_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| SCENE_EXTENSIONS.iter().any(|s| e.eq_ignore_ascii_case(s)))
}

/// Grants the fs scope for one file the user handed us, then delivers it or holds it until the webview
/// has registered its listener (Tauri events are not buffered, so a launch-time emit would be lost).
fn queue_open<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    if !is_scene_file(&path) || !path.is_file() {
        return;
    }
    if app.fs_scope().allow_file(&path).is_err() {
        return;
    }
    let path = path.to_string_lossy().into_owned();
    remember_recent(app, &path);
    let shell = app.state::<Shell>();
    let mut opens = shell.opens.lock().unwrap();
    if opens.delivering {
        let _ = app.emit_to(MAIN_WINDOW, OPEN_FILE_EVENT, path);
    } else if !opens.pending.contains(&path) {
        opens.pending.push(path);
    }
}

/// Opens the drawings named on a command line: this launch's, or a later launch's handed over by the
/// single-instance plugin, whose relative paths are relative to its own working directory.
fn open_args<R: Runtime>(app: &AppHandle<R>, args: impl IntoIterator<Item = String>, cwd: &Path) {
    for arg in args.into_iter().filter(|a| !a.starts_with('-')) {
        if let Ok(path) = std::fs::canonicalize(cwd.join(arg)) {
            queue_open(app, path);
        }
    }
}

#[tauri::command]
fn take_pending_opens(shell: tauri::State<'_, Shell>) -> Vec<String> {
    let mut opens = shell.opens.lock().unwrap();
    opens.delivering = true;
    std::mem::take(&mut opens.pending)
}

/// Asks the webview to run its unsaved-changes guard. If it doesn't acknowledge in time (hung, or still
/// loading) the shell closes anyway, so a broken page can never trap the window or the app.
fn request_guard<R: Runtime>(
    app: &AppHandle<R>,
    kind: GuardKind,
    window: Option<tauri::Window<R>>,
) {
    let shell = app.state::<Shell>();
    let id = shell.guard_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit_to(MAIN_WINDOW, GUARD_EVENT, GuardRequest { id, kind });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(GUARD_ACK_TIMEOUT);
        if app.state::<Shell>().guard_acked.load(Ordering::SeqCst) >= id {
            return;
        }
        match (kind, window) {
            (GuardKind::Close, Some(window)) => {
                let _ = window.destroy();
            }
            (GuardKind::Terminate, _) => finish_terminate(&app, true),
            _ => app.exit(0),
        }
    });
}

fn finish_terminate<R: Runtime>(app: &AppHandle<R>, allow: bool) {
    if app
        .state::<Shell>()
        .terminate_pending
        .swap(false, Ordering::SeqCst)
    {
        native::reply_to_terminate(app, allow);
    }
}

#[tauri::command]
fn terminate_reply<R: Runtime>(app: AppHandle<R>, allowed: bool) {
    finish_terminate(&app, allowed);
}

/// Routes AppKit's own termination (Dock > Quit, log out, shut down) through the same guard as Cmd+Q.
fn guard_termination<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    native::on_should_terminate(move || {
        let shell = app.state::<Shell>();
        if !shell.guard_ready.load(Ordering::SeqCst) {
            return false;
        }
        if !shell.terminate_pending.swap(true, Ordering::SeqCst) {
            request_guard(&app, GuardKind::Terminate, None);
        }
        true
    });
}

#[tauri::command]
fn guard_ready(shell: tauri::State<'_, Shell>) {
    shell.guard_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn guard_ack(shell: tauri::State<'_, Shell>, id: u64) {
    shell.guard_acked.fetch_max(id, Ordering::SeqCst);
}

#[tauri::command]
fn exit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

/// True when `path` names something strictly inside `base`, with no `.` or `..` to climb out through.
fn is_inside(base: &Path, path: &Path) -> bool {
    let plain = path.components().all(|c| {
        matches!(
            c,
            Component::RootDir | Component::Prefix(_) | Component::Normal(_)
        )
    });
    path.is_absolute() && plain && path.starts_with(base) && path != base
}

/// Resolves a path the webview sent for app-data storage, refusing anything outside the app data folder.
fn app_data_path<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    webview_data_path(&base, Path::new(path))
}

/// Also keeps the webview off the shell's own state: a page that could rewrite the recent list or the
/// session would have open_recent or the next launch grant it any file it named there.
fn webview_data_path(base: &Path, path: &Path) -> Result<PathBuf, String> {
    let refuse = || Err(format!("{} is outside the app data folder", path.display()));
    if !is_inside(base, path) {
        return refuse();
    }
    let Ok(rel) = path.strip_prefix(base) else {
        return refuse();
    };
    // plain ASCII names only, so case or Unicode folding on APFS can't alias a reserved name
    let plain = rel.components().all(|c| {
        c.as_os_str().to_str().is_some_and(|n| {
            n.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b" ._-".contains(&b))
        })
    });
    let first = rel
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or_default();
    // dot names cover the window-state file and write_atomic's temp files beside the shell's files
    let reserved = first.starts_with('.')
        || [
            RECENT_FILE,
            PREFS_FILE,
            SESSION_FILE,
            tauri_plugin_window_state::DEFAULT_FILENAME,
        ]
        .iter()
        .any(|r| first.eq_ignore_ascii_case(r));
    if !plain || reserved {
        return refuse();
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
fn appdata_read<R: Runtime>(app: AppHandle<R>, path: String) -> Result<String, String> {
    let path = app_data_path(&app, &path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn appdata_write<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let path = app_data_path(&app, &path)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(&path, contents.as_bytes()).map_err(|e| e.to_string())
}

/// Saves a document the user picked, opened from Finder or chose from Open Recent, without ever
/// truncating the file in place.
#[tauri::command]
fn document_write<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !app.fs_scope().is_allowed(&p) {
        // the same words as plugin-fs, which the webview reads as "ask for the path again"
        return Err(format!("forbidden path: {path}"));
    }
    write_atomic(&p, contents.as_bytes()).map_err(|e| format!("{path}: {e}"))
}

/// Renames a document the user opened or saved, within its folder and never over another file, so the
/// name in the window and the file on disk stay the same. Resolves the new path.
#[tauri::command]
fn document_rename<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    name: String,
) -> Result<String, String> {
    let from = PathBuf::from(&path);
    if !from.is_absolute() || !is_scene_file(&from) || !app.fs_scope().is_allowed(&from) {
        return Err(format!("forbidden path: {path}"));
    }
    let to = renamed_path(&from, &name)?;
    rename_no_replace(&from, &to).map_err(|e| rename_error(&e, &name))?;
    let _ = app.fs_scope().allow_file(&to);
    let renamed = to.to_string_lossy().into_owned();
    with_recent(&app, |list| list.retain(|p| p != &path));
    remember_recent(&app, &renamed);
    Ok(renamed)
}

/// `name` beside `from`: a plain drawing file name, so a rename can't move the file or hide it.
fn renamed_path(from: &Path, name: &str) -> Result<PathBuf, String> {
    let refuse = || Err(format!("\"{name}\" can't be used as a file name."));
    let mut parts = Path::new(name).components();
    let one_name = matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(_)), None)
    );
    // backslashes and colons are separators or drive prefixes elsewhere, and colons are slashes to Finder
    let plain = one_name
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && is_scene_file(Path::new(name));
    let Some(dir) = from.parent().filter(|_| plain) else {
        return refuse();
    };
    let to = dir.join(name);
    if to.parent() != Some(dir) {
        return refuse();
    }
    Ok(to)
}

fn rename_error(e: &std::io::Error, name: &str) -> String {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::AlreadyExists => format!("\"{name}\" already exists in that folder."),
        ErrorKind::PermissionDenied => "Nib isn't allowed to rename files in that folder.".into(),
        ErrorKind::NotFound => "It was moved or deleted.".into(),
        _ => e.to_string(),
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (a, b);
        false
    }
}

/// Like rename, but fails with AlreadyExists instead of replacing a file already at `to`.
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let c = |p: &Path| {
            CString::new(p.as_os_str().as_bytes())
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))
        };
        let (c_from, c_to) = (c(from)?, c(to)?);
        // SAFETY: both are NUL-terminated paths that outlive the call.
        if unsafe { libc::renamex_np(c_from.as_ptr(), c_to.as_ptr(), libc::RENAME_EXCL) } == 0 {
            return Ok(());
        }
        let err = std::io::Error::last_os_error();
        // ENOTSUP: a volume without exclusive renames (FAT, some network shares) gets the check below
        let unsupported = matches!(err.raw_os_error(), Some(libc::ENOTSUP | libc::EINVAL));
        // a change of case alone finds the file itself in the way on a case-insensitive volume
        let case_only = err.kind() == std::io::ErrorKind::AlreadyExists && same_file(from, to);
        if !unsupported && !case_only {
            return Err(err);
        }
    }
    if std::fs::symlink_metadata(to).is_ok() && !same_file(from, to) {
        return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
    }
    std::fs::rename(from, to)
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Writes beside `path` and renames over it, so a full disk, a crash or a power cut leaves either the old
/// file or the new one, never a truncated mix. The file keeps its permissions, extended attributes (Finder
/// tags and comments), ACL and creation date, a symlink stays a link and hard links stay linked.
fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};

    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let existing = std::fs::metadata(&target).ok();
    if let Some(meta) = &existing {
        if meta.is_dir() {
            return Err(Error::new(ErrorKind::InvalidInput, "is a folder"));
        }
        // a rename would slip past the read-only flag that an in-place write respects
        if meta.permissions().readonly() {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                "the file is read-only",
            ));
        }
    }
    let linked = existing.as_ref().is_some_and(has_other_links);
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return Err(Error::new(ErrorKind::InvalidInput, "not a file path"));
    };
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(
        ".{}.{}-{seq}.tmp",
        name.to_string_lossy(),
        std::process::id()
    ));
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
    {
        Ok(file) => file,
        // a writable file in a folder that isn't: replacing it isn't possible, so write it in place
        Err(e) if e.kind() == ErrorKind::PermissionDenied && existing.is_some() => {
            return write_in_place(&target, contents);
        }
        Err(e) => return Err(e),
    };
    let written: std::io::Result<()> = (|| {
        file.write_all(contents)?;
        if let (Some(meta), false) = (&existing, linked) {
            file.set_permissions(meta.permissions())?;
            keep_metadata(&target, &file, meta);
        }
        file.sync_all()?;
        drop(file);
        if linked {
            // a rename would leave the file's other names on the old contents; the full copy beside it
            // has shown the new contents fit, so they go into the file itself
            std::fs::remove_file(&tmp)?;
            return write_in_place(&target, contents);
        }
        std::fs::rename(&tmp, &target)?;
        // the rename itself is only durable once the folder is flushed
        if let Ok(folder) = std::fs::File::open(dir) {
            let _ = folder.sync_all();
        }
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

fn write_in_place(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

#[cfg(unix)]
fn has_other_links(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    meta.nlink() > 1
}

#[cfg(not(unix))]
fn has_other_links(_: &std::fs::Metadata) -> bool {
    false
}

/// Gives the replacement what an in-place write would have kept: extended attributes (Finder tags and
/// comments, labels), the ACL, the creation date and Finder's Date Added. Best effort, so a save never fails
/// over metadata.
#[cfg(target_os = "macos")]
fn keep_metadata(original: &Path, replacement: &std::fs::File, meta: &std::fs::Metadata) {
    use std::os::fd::AsRawFd;
    use std::time::UNIX_EPOCH;

    let source = std::fs::File::open(original).ok();
    if let Some(source) = &source {
        // SAFETY: both descriptors stay open for the whole call, and copyfile takes a null state.
        unsafe {
            libc::fcopyfile(
                source.as_raw_fd(),
                replacement.as_raw_fd(),
                std::ptr::null_mut(),
                libc::COPYFILE_XATTR | libc::COPYFILE_ACL,
            );
        }
    }
    // COPYFILE_STAT would also bring back the old modification time, which is how other apps see the save
    if let Some(created) = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    {
        set_time_attr(
            replacement,
            libc::ATTR_CMN_CRTIME,
            libc::timespec {
                tv_sec: created.as_secs() as libc::time_t,
                tv_nsec: created.subsec_nanos() as libc::c_long,
            },
        );
    }
    // the renamed-in temp file would otherwise move the document in a folder sorted by Date Added
    if let Some(added) = source.as_ref().and_then(added_time) {
        set_time_attr(replacement, libc::ATTR_CMN_ADDEDTIME, added);
    }
}

/// Finder's Date Added, when the volume records one for the file.
#[cfg(target_os = "macos")]
fn added_time(file: &std::fs::File) -> Option<libc::timespec> {
    use std::os::fd::AsRawFd;

    let mut list = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: libc::ATTR_CMN_ADDEDTIME,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    // a u32 length, then the timespec packed at 4-byte alignment
    let mut buf = [0u8; 4 + std::mem::size_of::<libc::timespec>()];
    // SAFETY: the buffer outlives the call and its size is passed with it.
    let rc = unsafe {
        libc::fgetattrlist(
            file.as_raw_fd(),
            (&mut list as *mut libc::attrlist).cast(),
            buf.as_mut_ptr().cast(),
            buf.len(),
            0,
        )
    };
    let returned = u32::from_ne_bytes(buf[..4].try_into().ok()?) as usize;
    if rc != 0 || returned != buf.len() {
        return None;
    }
    // SAFETY: the kernel filled bytes 4.. with one timespec; read_unaligned copes with the 4-byte packing.
    Some(unsafe { std::ptr::read_unaligned(buf[4..].as_ptr().cast::<libc::timespec>()) })
}

#[cfg(target_os = "macos")]
fn set_time_attr(file: &std::fs::File, attr: libc::attrgroup_t, mut time: libc::timespec) {
    use std::os::fd::AsRawFd;

    let mut list = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: attr,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    // SAFETY: a single time attribute reads exactly one timespec from the buffer, which outlives the call.
    unsafe {
        libc::fsetattrlist(
            file.as_raw_fd(),
            (&mut list as *mut libc::attrlist).cast(),
            (&mut time as *mut libc::timespec).cast(),
            std::mem::size_of::<libc::timespec>(),
            0,
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn keep_metadata(_: &Path, _: &std::fs::File, _: &std::fs::Metadata) {}

#[tauri::command]
fn appdata_exists<R: Runtime>(app: AppHandle<R>, path: String) -> Result<bool, String> {
    Ok(app_data_path(&app, &path)?.exists())
}

#[tauri::command]
fn appdata_remove<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let path = app_data_path(&app, &path)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn app_data_file<R: Runtime>(app: &AppHandle<R>, name: &str) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(name))
}

/// Runs `f` on a JSON document cached in `slot` (loaded from app data on first use) and writes it back
/// when `f` changed it.
fn with_stored<R: Runtime, T, O>(
    app: &AppHandle<R>,
    slot: &Mutex<Option<T>>,
    file: &str,
    f: impl FnOnce(&mut T) -> O,
) -> O
where
    T: Serialize + DeserializeOwned + Default + Clone + PartialEq,
{
    let mut guard = slot.lock().unwrap();
    let value = guard.get_or_insert_with(|| {
        app_data_file(app, file)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<T>(&s).ok())
            .unwrap_or_default()
    });
    let before = value.clone();
    let out = f(value);
    if *value != before {
        if let (Some(p), Ok(json)) = (app_data_file(app, file), serde_json::to_vec(value)) {
            let _ = write_atomic(&p, &json);
        }
    }
    out
}

fn with_recent<R: Runtime, T>(app: &AppHandle<R>, f: impl FnOnce(&mut Vec<String>) -> T) -> T {
    with_stored(app, &app.state::<Shell>().recent, RECENT_FILE, f)
}

fn remember_recent<R: Runtime>(app: &AppHandle<R>, path: &str) {
    with_recent(app, |list| {
        list.retain(|p| p != path);
        list.insert(0, path.to_string());
        list.truncate(MAX_RECENT);
    });
    native::note_recent_document(app, path);
}

#[tauri::command]
fn recent_list<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    with_recent(&app, |list| list.clone())
}

/// Only paths the user already granted (dialog, Finder) may be added, so the webview can't use the list
/// to reach arbitrary files later.
#[tauri::command]
fn recent_add<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Vec<String>, String> {
    let p = Path::new(&path);
    if !is_scene_file(p) || !app.fs_scope().is_allowed(p) {
        return Err(format!("{path} was not opened or saved by the user"));
    }
    remember_recent(&app, &path);
    Ok(recent_list(app))
}

#[tauri::command]
fn recent_clear<R: Runtime>(app: AppHandle<R>) {
    with_recent(&app, |list| list.clear());
    native::clear_recent_documents(&app);
}

/// Re-grants the fs scope for a recent document (scopes don't survive a relaunch).
#[tauri::command]
fn open_recent<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let known = with_recent(&app, |list| list.contains(&path));
    if !known {
        return Err(format!("{path} is not a recent document"));
    }
    let p = PathBuf::from(&path);
    if !p.is_file() {
        with_recent(&app, |list| list.retain(|x| x != &path));
        return Err(format!("{path} no longer exists"));
    }
    check_recent_target(&p)?;
    app.fs_scope().allow_file(&p).map_err(|e| e.to_string())?;
    remember_recent(&app, &path);
    Ok(())
}

/// The recent list is a file on disk, so what it names is checked again before it is granted: a drawing,
/// by an absolute path, that is a drawing after symlinks are followed too.
fn check_recent_target(p: &Path) -> Result<(), String> {
    let real = std::fs::canonicalize(p).map_err(|e| format!("{}: {e}", p.display()))?;
    if p.is_absolute() && is_scene_file(p) && is_scene_file(&real) && real.is_file() {
        Ok(())
    } else {
        Err(format!("{} is not a drawing", p.display()))
    }
}

/// The save panel grants exactly the path it returns; this extends that grant to the same path with the
/// format's extension appended, and to nothing else.
#[tauri::command]
fn allow_with_extension<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    ext: String,
) -> Result<String, String> {
    let valid_ext =
        !ext.is_empty() && ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric());
    let p = Path::new(&path);
    if !valid_ext || !app.fs_scope().is_allowed(p) {
        return Err(format!("{path} was not chosen by the user"));
    }
    let target = format!("{path}.{ext}");
    app.fs_scope()
        .allow_file(&target)
        .map_err(|e| e.to_string())?;
    Ok(target)
}

/// A mirror of the webview's localStorage prefs that survives WebKit dropping its last writes when the
/// process exits straight after them.
#[tauri::command]
fn prefs_set<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value: Option<String>,
    rev: u64,
) -> Result<(), String> {
    with_stored(&app, &app.state::<Shell>().prefs, PREFS_FILE, |prefs| {
        prefs.apply(key, value, rev)
    })
}

#[tauri::command]
fn set_document_edited<R: Runtime>(window: WebviewWindow<R>, edited: bool) {
    native::set_document_edited(&window, edited);
}

/// Tab > Reveal in Finder (or the file manager) for a drawing the user opened or saved.
#[tauri::command]
fn reveal_document<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !is_scene_file(p) || !app.fs_scope().is_allowed(p) {
        return Err(format!("forbidden path: {path}"));
    }
    tauri_plugin_opener::reveal_item_in_dir(p).map_err(|e| e.to_string())
}

/// Shows the document's proxy icon in the title bar; None or an empty path removes it.
#[tauri::command]
fn set_represented_file<R: Runtime>(
    window: WebviewWindow<R>,
    path: Option<String>,
) -> Result<(), String> {
    let path = path.unwrap_or_default();
    let p = Path::new(&path);
    if !(path.is_empty() || p.is_absolute() && is_scene_file(p)) {
        return Err(format!("{path} is not a drawing"));
    }
    native::set_represented_file(&window, &path);
    Ok(())
}

/// Recovery copies left in the recovery folder, by slot.
fn recovery_copies<R: Runtime>(app: &AppHandle<R>) -> Vec<RecoveryCopy> {
    let Some(entries) = app_data_file(app, RECOVERY_DIR).and_then(|d| std::fs::read_dir(d).ok())
    else {
        return vec![];
    };
    let mut copies: Vec<RecoveryCopy> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let slot = name.strip_suffix(".meta.json")?.to_string();
            if !session::is_slot_name(&slot) {
                return None;
            }
            // the page writes the metadata, so only its dirty flag is read, and anything unclear counts as unsaved
            let unsaved = std::fs::read_to_string(e.path())
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.get("dirty").and_then(|d| d.as_bool()))
                != Some(false);
            Some(RecoveryCopy { slot, unsaved })
        })
        .collect();
    copies.sort_by(|a, b| a.slot.cmp(&b.slot));
    copies
}

/// The tabs the page opens at launch (see session::plan_restore), as the boot script hands them over.
fn restore_session<R: Runtime>(app: &AppHandle<R>, prefs: &PrefsSnapshot) -> serde_json::Value {
    let saved = app_data_file(app, SESSION_FILE)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| Session::parse(&t))
        .unwrap_or_default();
    let plan = session::plan_restore(&saved, prefs.reopen_tabs(), &recovery_copies(app), |p| {
        check_recent_target(Path::new(p)).is_ok()
    });
    if let Some(dir) = app_data_file(app, RECOVERY_DIR) {
        for slot in &plan.stale {
            let _ = std::fs::remove_file(dir.join(format!("{slot}.meta.json")));
            let _ = std::fs::remove_file(dir.join(format!("{slot}.nibd")));
        }
    }
    // the session file is the shell's own, so the documents it names are the user's to reopen and save
    for path in plan.tabs.iter().filter_map(|t| t.path.as_deref()) {
        if check_recent_target(Path::new(path)).is_ok() {
            let _ = app.fs_scope().allow_file(path);
        }
    }
    *app.state::<Shell>().session.lock().unwrap() = Some(saved);
    serde_json::json!({
        "tabs": plan.tabs,
        "active": plan.active,
        "notices": session::missing_notice(&plan.missing).into_iter().collect::<Vec<_>>(),
    })
}

/// The page's tabs, for the next launch. Only paths the user granted are kept, so a page can't have the
/// next launch grant it another file.
#[tauri::command]
fn session_report<R: Runtime>(
    app: AppHandle<R>,
    tabs: Vec<TabEntry>,
    active: usize,
) -> Result<(), String> {
    let tabs = tabs
        .into_iter()
        .map(|mut t| {
            t.path = t
                .path
                .filter(|p| is_scene_file(Path::new(p)) && app.fs_scope().is_allowed(Path::new(p)));
            t
        })
        .collect();
    let next = Session::cleaned(tabs, active);
    let shell = app.state::<Shell>();
    let mut last = shell.session.lock().unwrap();
    if last.as_ref() == Some(&next) {
        return Ok(());
    }
    let path = app_data_file(&app, SESSION_FILE).ok_or("no app data folder")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(&path, &next.to_json()).map_err(|e| e.to_string())?;
    *last = Some(next);
    Ok(())
}

/// The window is created here rather than from tauri.conf so it can carry the boot script and stay
/// hidden until its saved frame is back.
fn create_main_window<R: Runtime>(app: &AppHandle<R>, updater: bool) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .cloned()
        .unwrap_or_default();
    let prefs = with_stored(app, &app.state::<Shell>().prefs, PREFS_FILE, |p| p.clone());
    let session = restore_session(app, &prefs);
    let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(prefs::boot_script(&prefs, updater, &session))
        .theme(native::system_theme())
        .build()?;
    let _ = window.restore_state(WINDOW_STATE.difference(StateFlags::FULLSCREEN));
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_FALLBACK);
        reveal_main_window(&app);
    });
    Ok(())
}

/// Shows the main window once, after its page has painted the saved theme's board, so a dark theme
/// never opens on a flash of the empty light webview.
fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<Shell>().revealed.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
    // entering full screen needs a visible window
    let _ = window.restore_state(StateFlags::FULLSCREEN);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let updater = updates::configured(context.config()) && updates::can_install();
    let mut builder = tauri::Builder::default();
    // registered first so a second launch exits before it builds anything of its own
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_args(app, argv.into_iter().skip(1), Path::new(&cwd));
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(WINDOW_STATE)
                .skip_initial_state(MAIN_WINDOW)
                .build(),
        );
    if updater {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .manage(Shell::default())
        .manage(updates::Updates::new(updater))
        .invoke_handler(tauri::generate_handler![
            take_pending_opens,
            guard_ready,
            guard_ack,
            exit_app,
            terminate_reply,
            appdata_read,
            appdata_write,
            appdata_exists,
            appdata_remove,
            document_write,
            document_rename,
            recent_list,
            recent_add,
            recent_clear,
            open_recent,
            allow_with_extension,
            prefs_set,
            set_document_edited,
            set_represented_file,
            session_report,
            reveal_document,
            updates::updater_check,
            updates::updater_install,
            updates::relaunch_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let cwd = std::env::current_dir().unwrap_or_default();
            open_args(&handle, std::env::args().skip(1), &cwd);
            create_main_window(&handle, updater)?;
            guard_termination(&handle);
            Ok(())
        })
        // a reloaded page has no listeners until it registers again; hold opens and stop guarding till then
        .on_page_load(|webview, payload| match payload.event() {
            tauri::webview::PageLoadEvent::Started => {
                let shell = webview.state::<Shell>();
                shell.guard_ready.store(false, Ordering::SeqCst);
                shell.opens.lock().unwrap().delivering = false;
            }
            tauri::webview::PageLoadEvent::Finished => reveal_main_window(webview.app_handle()),
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<Shell>().guard_ready.load(Ordering::SeqCst) {
                    api.prevent_close();
                    request_guard(app, GuardKind::Close, Some(window.clone()));
                }
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == QUIT_MENU_ID {
                if app.state::<Shell>().guard_ready.load(Ordering::SeqCst) {
                    request_guard(app, GuardKind::Quit, None);
                } else {
                    app.exit(0);
                }
            } else if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                if id == CLOSE_MENU_ID {
                    // close, unlike destroy, goes through CloseRequested and so the unsaved-changes guard
                    let _ = window.close();
                } else if id == FULLSCREEN_MENU_ID {
                    let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
                }
            }
        })
        .build(context)
        .expect("failed to build Nib")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        queue_open(app, path);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_extensions_are_case_insensitive() {
        assert!(is_scene_file(Path::new("/a/Board.nibd")));
        assert!(is_scene_file(Path::new("/a/Board.NIBD")));
        assert!(is_scene_file(Path::new("/a/b.Excalidraw")));
        assert!(!is_scene_file(Path::new("/a/b.png")));
        assert!(!is_scene_file(Path::new("/a/b.nib")));
        assert!(!is_scene_file(Path::new("/a/nibd")));
        assert!(!is_scene_file(Path::new("/a/old.txt")));
    }

    #[test]
    fn app_data_paths_cannot_escape() {
        let base = Path::new("/Users/u/Library/Application Support/app.nib.desktop");
        assert!(is_inside(base, &base.join("recovery/current.nibd")));
        assert!(!is_inside(base, base));
        assert!(!is_inside(base, &base.join("../other/secrets.json")));
        assert!(!is_inside(base, Path::new("/Users/u/Documents/plan.nibd")));
        assert!(!is_inside(
            base,
            Path::new("/Users/u/Library/Application Support/app.nib.desktop-evil/x")
        ));
        assert!(!is_inside(base, Path::new("recovery/current.nibd")));
    }

    #[test]
    fn the_webview_cannot_reach_the_shells_own_files() {
        let base = Path::new("/Users/u/Library/Application Support/app.nib.desktop");
        for ok in [
            "recovery/current.nibd",
            "recovery/current.meta.json",
            "recovery/t1759750000000-2.nibd",
            "library.excalidrawlib",
        ] {
            assert!(
                webview_data_path(base, &base.join(ok)).is_ok(),
                "{ok} was refused"
            );
        }
        for bad in [
            RECENT_FILE,
            PREFS_FILE,
            SESSION_FILE,
            "Session.JSON",
            ".session.json.1-0.tmp",
            "session.json/x",
            "Recent-Files.JSON",
            "PREFS.json",
            ".window-state.json",
            ".recent-files.json.1-0.tmp",
            "recent-files.json/x",
            "pre\u{17f}s.json",
            "../x.json",
        ] {
            assert!(
                webview_data_path(base, &base.join(bad)).is_err(),
                "{bad} was accepted"
            );
        }
    }

    #[test]
    fn open_recent_grants_only_drawings_by_absolute_path() {
        let dir = scratch("recent");
        let drawing = dir.join("plan.nibd");
        let notes = dir.join("notes.txt");
        std::fs::write(&drawing, "{}").unwrap();
        std::fs::write(&notes, "secret").unwrap();
        assert!(check_recent_target(&drawing).is_ok());
        assert!(check_recent_target(&notes).is_err());
        assert!(check_recent_target(Path::new("plan.nibd")).is_err());
        assert!(check_recent_target(&dir.join("missing.nibd")).is_err());
        #[cfg(unix)]
        {
            let disguised = dir.join("disguised.nibd");
            std::os::unix::fs::symlink(&notes, &disguised).unwrap();
            assert!(check_recent_target(&disguised).is_err());
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nib-write-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn atomic_writes_replace_the_file_and_leave_no_temp_behind() {
        let dir = scratch("replace");
        let file = dir.join("plan.nibd");
        write_atomic(&file, b"first").unwrap();
        write_atomic(&file, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "second");
        assert!(leftovers(&dir).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn atomic_writes_keep_permissions_and_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = scratch("keep");
        let real = dir.join("real.nibd");
        std::fs::write(&real, "old").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o640)).unwrap();
        let link = dir.join("link.nibd");
        symlink(&real, &link).unwrap();
        write_atomic(&link, b"new").unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new");
        let mode = std::fs::metadata(&real).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }

    #[test]
    fn renames_stay_in_the_folder_and_keep_a_drawing_extension() {
        let from = Path::new("/Users/u/Docs/Board A.nibd");
        assert_eq!(
            renamed_path(from, "Renamed board.nibd").unwrap(),
            Path::new("/Users/u/Docs/Renamed board.nibd")
        );
        assert_eq!(
            renamed_path(from, "plan.nibd").unwrap(),
            Path::new("/Users/u/Docs/plan.nibd")
        );
        for bad in [
            "",
            "..",
            "../x.nibd",
            "a/b.nibd",
            "a\\b.nibd",
            ".hidden.nibd",
            "C:x.nibd",
            "/abs.nibd",
            "notes.txt",
            "a\0b.nibd",
        ] {
            assert!(renamed_path(from, bad).is_err(), "{bad} was accepted");
        }
    }

    #[test]
    fn a_rename_never_replaces_another_file() {
        let dir = scratch("rename");
        let from = dir.join("Board A.nibd");
        let taken = dir.join("Notes.nibd");
        std::fs::write(&from, "board").unwrap();
        std::fs::write(&taken, "notes").unwrap();
        let err = rename_no_replace(&from, &taken).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&taken).unwrap(), "notes");
        assert_eq!(std::fs::read_to_string(&from).unwrap(), "board");

        let to = dir.join("Renamed board.nibd");
        rename_no_replace(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "board");
        assert!(!from.exists());
    }

    #[test]
    fn a_rename_can_change_only_the_case() {
        let dir = scratch("case");
        let from = dir.join("board.nibd");
        std::fs::write(&from, "board").unwrap();
        let to = dir.join("Board.nibd");
        rename_no_replace(&from, &to).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["Board.nibd".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_writes_keep_hard_links() {
        let dir = scratch("links");
        let file = dir.join("plan.nibd");
        std::fs::write(&file, "old").unwrap();
        let other = dir.join("also plan.nibd");
        std::fs::hard_link(&file, &other).unwrap();
        write_atomic(&file, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "new");
        assert!(leftovers(&dir).is_empty());
    }

    #[cfg(target_os = "macos")]
    mod finder {
        use super::*;
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::time::{Duration, UNIX_EPOCH};

        const TAGS: &str = "com.apple.metadata:_kMDItemUserTags";
        const COMMENT: &str = "com.apple.metadata:kMDItemFinderComment";
        const FINDER_INFO: &str = "com.apple.FinderInfo";

        fn c_path(path: &Path) -> CString {
            CString::new(path.as_os_str().as_bytes()).unwrap()
        }

        fn set_xattr(path: &Path, name: &str, value: &[u8]) {
            let name = CString::new(name).unwrap();
            let rc = unsafe {
                libc::setxattr(
                    c_path(path).as_ptr(),
                    name.as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            };
            assert_eq!(
                rc,
                0,
                "setxattr failed: {}",
                std::io::Error::last_os_error()
            );
        }

        fn get_xattr(path: &Path, name: &str) -> Option<Vec<u8>> {
            let name = CString::new(name).unwrap();
            let mut buf = vec![0u8; 4096];
            let n = unsafe {
                libc::getxattr(
                    c_path(path).as_ptr(),
                    name.as_ptr(),
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    0,
                    0,
                )
            };
            (n >= 0).then(|| {
                buf.truncate(n as usize);
                buf
            })
        }

        fn attrs(attr: libc::attrgroup_t) -> libc::attrlist {
            libc::attrlist {
                bitmapcount: libc::ATTR_BIT_MAP_COUNT,
                reserved: 0,
                commonattr: attr,
                volattr: 0,
                dirattr: 0,
                fileattr: 0,
                forkattr: 0,
            }
        }

        fn set_time(path: &Path, attr: libc::attrgroup_t, secs: i64) {
            let mut list = attrs(attr);
            let mut time = libc::timespec {
                tv_sec: secs,
                tv_nsec: 0,
            };
            let rc = unsafe {
                libc::setattrlist(
                    c_path(path).as_ptr(),
                    (&mut list as *mut libc::attrlist).cast(),
                    (&mut time as *mut libc::timespec).cast(),
                    std::mem::size_of::<libc::timespec>(),
                    0,
                )
            };
            assert_eq!(
                rc,
                0,
                "setattrlist failed: {}",
                std::io::Error::last_os_error()
            );
        }

        fn set_created(path: &Path, secs: i64) {
            set_time(path, libc::ATTR_CMN_CRTIME, secs);
        }

        fn date_added(path: &Path) -> i64 {
            let mut list = attrs(libc::ATTR_CMN_ADDEDTIME);
            let mut buf = [0u8; 4 + std::mem::size_of::<libc::timespec>()];
            let rc = unsafe {
                libc::getattrlist(
                    c_path(path).as_ptr(),
                    (&mut list as *mut libc::attrlist).cast(),
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    0,
                )
            };
            assert_eq!(
                rc,
                0,
                "getattrlist failed: {}",
                std::io::Error::last_os_error()
            );
            assert_eq!(
                u32::from_ne_bytes(buf[..4].try_into().unwrap()) as usize,
                buf.len()
            );
            unsafe { std::ptr::read_unaligned(buf[4..].as_ptr().cast::<libc::timespec>()) }.tv_sec
        }

        #[test]
        fn atomic_writes_keep_tags_comments_and_the_creation_date() {
            let dir = scratch("finder");
            let file = dir.join("tagged.nibd");
            std::fs::write(&file, "old").unwrap();
            let tags = b"bplist00\xa1\x01URed\n6\x08\x0a\x00\x00\x00\x00\x00\x00\x01\x01\x00\x00\x00\x00\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10";
            set_xattr(&file, TAGS, tags);
            set_xattr(&file, COMMENT, b"bplist00Ttodo\x08\x00\x00\x00\x00\x00\x00\x01\x01\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x0d");
            let mut label = [0u8; 32];
            label[9] = 0x0c;
            set_xattr(&file, FINDER_INFO, &label);
            set_created(&file, 1_577_836_800);

            write_atomic(&file, b"new").unwrap();

            assert_eq!(std::fs::read_to_string(&file).unwrap(), "new");
            assert_eq!(get_xattr(&file, TAGS).as_deref(), Some(&tags[..]));
            assert!(get_xattr(&file, COMMENT).is_some());
            assert_eq!(get_xattr(&file, FINDER_INFO).as_deref(), Some(&label[..]));
            let created = std::fs::metadata(&file).unwrap().created().unwrap();
            assert_eq!(created, UNIX_EPOCH + Duration::from_secs(1_577_836_800));
            let modified = std::fs::metadata(&file).unwrap().modified().unwrap();
            assert!(modified > created, "the save is the latest modification");
            assert!(leftovers(&dir).is_empty());
        }

        #[test]
        fn atomic_writes_keep_the_date_added() {
            let dir = scratch("added");
            let file = dir.join("dated.nibd");
            std::fs::write(&file, "old").unwrap();
            set_time(&file, libc::ATTR_CMN_ADDEDTIME, 1_600_000_000);
            assert_eq!(date_added(&file), 1_600_000_000);

            write_atomic(&file, b"new").unwrap();

            assert_eq!(std::fs::read_to_string(&file).unwrap(), "new");
            assert_eq!(date_added(&file), 1_600_000_000);
            assert!(leftovers(&dir).is_empty());
        }
    }

    #[test]
    fn atomic_writes_refuse_a_read_only_file_and_keep_it_whole() {
        let dir = scratch("readonly");
        let file = dir.join("locked.nibd");
        std::fs::write(&file, "precious").unwrap();
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).unwrap();
        assert!(write_atomic(&file, b"oops").is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "precious");
        assert!(leftovers(&dir).is_empty());
    }
}
