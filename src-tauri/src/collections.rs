//! Collections live on disk like in Bruno: a folder with a `burno.json` file,
//! one `.json` file per request and sub-folders for grouping.

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

const META_FILE: &str = "burno.json";
const SKIPPED_DIRS: [&str; 3] = ["node_modules", "environments", "target"];

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TreeNode {
    Folder { name: String, path: String, children: Vec<TreeNode> },
    Request { path: String, data: Value },
}

impl TreeNode {
    fn sort_key(&self) -> (u8, String) {
        match self {
            TreeNode::Folder { path, .. } => (0, path.to_lowercase()),
            TreeNode::Request { path, .. } => (1, path.to_lowercase()),
        }
    }
}

#[derive(Serialize)]
pub struct Collection {
    root: String,
    name: String,
    children: Vec<TreeNode>,
}

/// Joins a collection-relative path, refusing anything that escapes the collection.
fn resolve(root: &str, rel: &str) -> Res<PathBuf> {
    let root = Path::new(root);
    if !root.join(META_FILE).is_file() {
        return Err(format!("{} is not a Burno collection (no {META_FILE})", root.display()));
    }
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Invalid path: {}", rel.display()));
    }
    Ok(root.join(rel))
}

/// Collection-relative path with `/` separators on every OS.
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn write_meta(dir: &Path, name: &str) -> Res<()> {
    let path = dir.join(META_FILE);
    let mut meta: Value = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "version": 1 }));
    meta["name"] = json!(name);
    fs::write(path, serde_json::to_string_pretty(&meta).map_err(err)?).map_err(err)
}

fn read_tree(root: &Path, dir: &Path) -> Res<Vec<TreeNode>> {
    let mut nodes = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let path = entry.map_err(err)?.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                let children = read_tree(root, &path)?;
                nodes.push(TreeNode::Folder { name, path: relative(root, &path), children });
            }
        } else if name.ends_with(".json") && !(dir == root && name == META_FILE) {
            // Skip unreadable / invalid files instead of failing the whole collection
            let data = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok());
            if let Some(data) = data {
                nodes.push(TreeNode::Request { path: relative(root, &path), data });
            }
        }
    }
    nodes.sort_by_key(TreeNode::sort_key);
    Ok(nodes)
}

fn to_json(data: &Value) -> Res<String> {
    serde_json::to_string_pretty(data).map_err(err)
}

#[tauri::command]
pub fn collection_load(root: String) -> Res<Collection> {
    let dir = resolve(&root, "")?;
    let meta: Value = fs::read_to_string(dir.join(META_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let name = meta["name"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| dir.file_name().unwrap_or_default().to_string_lossy().to_string());
    Ok(Collection { children: read_tree(&dir, &dir)?, root, name })
}

/// Creates `<parent>/<name>` (or `<name> 2`, ...) as a new collection and returns its path.
#[tauri::command]
pub fn collection_create(parent: String, name: String) -> Res<String> {
    let mut dir = Path::new(&parent).join(&name);
    for i in 2.. {
        if !dir.exists() {
            break;
        }
        dir = Path::new(&parent).join(format!("{name} {i}"));
    }
    fs::create_dir_all(&dir).map_err(err)?;
    write_meta(&dir, &name)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn collection_rename(root: String, name: String) -> Res<()> {
    write_meta(&resolve(&root, "")?, &name)
}

/// The collection used when nothing is open yet, inside the app data folder.
#[tauri::command]
pub fn collection_default(app: AppHandle) -> Res<String> {
    let dir = app.path().app_data_dir().map_err(err)?.join("collections").join("My Collection");
    if !dir.join(META_FILE).is_file() {
        fs::create_dir_all(&dir).map_err(err)?;
        write_meta(&dir, "My Collection")?;
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn request_create(root: String, path: String, data: Value) -> Res<()> {
    let file = resolve(&root, &path)?;
    if file.exists() {
        return Err(format!("{path} already exists"));
    }
    fs::write(file, to_json(&data)?).map_err(err)
}

#[tauri::command]
pub fn request_write(root: String, path: String, data: Value) -> Res<()> {
    fs::write(resolve(&root, &path)?, to_json(&data)?).map_err(err)
}

#[tauri::command]
pub fn folder_create(root: String, path: String) -> Res<()> {
    let dir = resolve(&root, &path)?;
    if dir.exists() {
        return Err(format!("{path} already exists"));
    }
    fs::create_dir(dir).map_err(err)
}

#[tauri::command]
pub fn entry_rename(root: String, from: String, to: String) -> Res<()> {
    let source = resolve(&root, &from)?;
    let target = resolve(&root, &to)?;
    // A case-only rename hits the same file on case-insensitive file systems
    let same_entry = from.to_lowercase() == to.to_lowercase();
    if target.exists() && !same_entry {
        return Err(format!("{to} already exists"));
    }
    fs::rename(source, target).map_err(err)
}

/// Moves a request file or folder to the OS trash.
#[tauri::command]
pub fn entry_delete(root: String, path: String) -> Res<()> {
    if path.is_empty() {
        return Err("Cannot delete the collection root".into());
    }
    trash::delete(resolve(&root, &path)?).map_err(err)
}
