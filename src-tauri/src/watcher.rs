//! Tells the frontend when a collection changes on disk (git pull, another editor…).
//! Writes made by the app itself are recognised by their content and stay silent.

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const DEBOUNCE: Duration = Duration::from_millis(300);
const EVENT: &str = "collection-changed";
const IGNORED_DIRS: [&str; 2] = ["node_modules", "target"];

/// Content hash of the last write of each file made by the app
static OWN_WRITES: LazyLock<Mutex<HashMap<PathBuf, u64>>> = LazyLock::new(Default::default);

#[derive(Default)]
pub struct CollectionWatcher(Mutex<Option<Debouncer<RecommendedWatcher>>>);

fn content_hash(content: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

/// Canonical form of a path, also for one that does not exist yet: event paths are canonical.
fn canonical(path: &Path) -> PathBuf {
    if let Ok(path) = path.canonicalize() {
        return path;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => canonical(parent).join(name),
        _ => path.to_path_buf(),
    }
}

/// `fs::write` for collection files: the watcher won't report this write as a change.
pub fn write_file(path: &Path, content: &str) -> io::Result<()> {
    let hash = content_hash(content.as_bytes());
    let key = canonical(path);
    // Recorded first: the event can arrive before this function returns
    OWN_WRITES.lock().unwrap().insert(key.clone(), hash);
    let result = fs::write(path, content);
    if result.is_err() {
        OWN_WRITES.lock().unwrap().remove(&key);
    }
    result
}

fn is_own_write(path: &Path) -> bool {
    let key = canonical(path);
    let mut writes = OWN_WRITES.lock().unwrap();
    let own = fs::read(path).is_ok_and(|content| writes.get(&key) == Some(&content_hash(&content)));
    // Once changed from outside, going back to the same content (a branch switch) is a change too
    if !own {
        writes.remove(&key);
    }
    own
}

/// Only what Burno reads matters: not `.git/`, editor swap files, dependencies…
fn is_relevant(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    let hidden_or_ignored = rel.components().any(|c| match c {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            (name.starts_with('.') && name != ".env") || IGNORED_DIRS.contains(&name.as_ref())
        }
        _ => true,
    });
    if hidden_or_ignored {
        return false;
    }
    let name = rel.file_name().unwrap_or_default().to_string_lossy();
    // A path without extension may be a folder, and a removed one can't be checked
    name == ".env" || path.extension().is_none() || path.extension().is_some_and(|e| e == "json")
}

fn changed_roots(roots: &[PathBuf], paths: impl IntoIterator<Item = PathBuf>) -> BTreeSet<PathBuf> {
    let mut changed = BTreeSet::new();
    for path in paths {
        let path = canonical(&path);
        if let Some(root) = roots.iter().find(|root| is_relevant(root, &path)) {
            if !is_own_write(&path) {
                changed.insert(root.clone());
            }
        }
    }
    changed
}

/// Replaces the watched collections. A folder that can't be watched just won't live-reload.
#[tauri::command]
pub fn collections_watch(app: AppHandle, state: State<CollectionWatcher>, roots: Vec<String>) -> Result<(), String> {
    // Reported with the path the frontend knows
    let by_canonical: HashMap<PathBuf, String> = roots.iter().map(|r| (canonical(Path::new(r)), r.clone())).collect();
    let canonical_roots: Vec<PathBuf> = by_canonical.keys().cloned().collect();
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        for root in changed_roots(&canonical_roots, events.into_iter().map(|e| e.path)) {
            let _ = app.emit(EVENT, &by_canonical[&root]);
        }
    })
    .map_err(|e| e.to_string())?;
    for root in &roots {
        let _ = debouncer.watcher().watch(Path::new(root), RecursiveMode::Recursive);
    }
    *state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    fn temp_collection(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("burno-watch-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("users")).unwrap();
        canonical(&dir)
    }

    #[test]
    fn relevance() {
        let root = Path::new("/c");
        assert!(is_relevant(root, Path::new("/c/users/Get user.json")));
        assert!(is_relevant(root, Path::new("/c/environments/Dev.json")));
        assert!(is_relevant(root, Path::new("/c/.env")));
        assert!(is_relevant(root, Path::new("/c/users")));
        assert!(!is_relevant(root, Path::new("/c/.git/index")));
        assert!(!is_relevant(root, Path::new("/c/.git/refs/heads/main")));
        assert!(!is_relevant(root, Path::new("/c/node_modules/a/package.json")));
        assert!(!is_relevant(root, Path::new("/c/notes.txt")));
        assert!(!is_relevant(root, Path::new("/other/a.json")));
    }

    #[test]
    fn own_writes_are_silent_until_the_file_changes() {
        let root = temp_collection("own");
        let file = root.join("users/a.json");
        write_file(&file, "{}").unwrap();
        let roots = [root.clone()];
        assert!(changed_roots(&roots, [file.clone()]).is_empty());

        fs::write(&file, r#"{"url":"changed outside"}"#).unwrap();
        assert_eq!(changed_roots(&roots, [file.clone()]).len(), 1);

        // Switching back to a branch that has what the app last wrote
        fs::write(&file, "{}").unwrap();
        assert_eq!(changed_roots(&roots, [file.clone()]).len(), 1);

        fs::remove_file(&file).unwrap();
        assert_eq!(changed_roots(&roots, [file]).len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    /// Against the real file system: an outside change is reported, an own write is not.
    #[test]
    fn real_events() {
        let root = temp_collection("events");
        let roots = vec![root.clone()];
        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(100), move |result: DebounceEventResult| {
            let events = result.unwrap();
            let _ = tx.send(changed_roots(&roots, events.into_iter().map(|e| e.path)));
        })
        .unwrap();
        debouncer.watcher().watch(&root, RecursiveMode::Recursive).unwrap();
        std::thread::sleep(Duration::from_millis(300));

        // Collects what the watcher reports for a while
        let reported = |wait: Duration| {
            let end = Instant::now() + wait;
            let mut found = false;
            while let Some(left) = end.checked_duration_since(Instant::now()) {
                if let Ok(changed) = rx.recv_timeout(left) {
                    found |= !changed.is_empty();
                }
            }
            found
        };

        write_file(&root.join("users/a.json"), r#"{"name":"own"}"#).unwrap();
        assert!(!reported(Duration::from_millis(1000)), "own write was reported");

        fs::write(root.join("users/a.json"), r#"{"name":"outside"}"#).unwrap();
        assert!(reported(Duration::from_millis(1500)), "outside write was not reported");

        fs::rename(root.join("users"), root.join("people")).unwrap();
        assert!(reported(Duration::from_millis(1500)), "folder rename was not reported");
        drop(debouncer);
        fs::remove_dir_all(root).unwrap();
    }
}
