//! Serde mirror of `@angkorgit/core` TypeScript domain types.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub path: String,
    pub name: String,
    pub head_branch: Option<String>,
    pub head_oid: Option<String>,
    pub is_detached: bool,
    pub is_bare: bool,
    pub state: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepository {
    pub path: String,
    pub name: String,
    pub last_opened_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInfo {
    pub name: String,
    pub email: String,
    pub time: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub kind: String,
    pub name: String,
    pub shorthand: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub body: String,
    pub author: SignatureInfo,
    pub committer: SignatureInfo,
    pub parents: Vec<String>,
    pub refs: Vec<RefInfo>,
    pub is_head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<CommitInfo>,
    pub has_more: bool,
    pub total: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub skip: usize,
    pub limit: usize,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub target_oid: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub target_oid: String,
    pub message: Option<String>,
    pub is_annotated: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub head_oid: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    pub staged: Option<String>,
    pub unstaged: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSummary {
    pub files: Vec<FileStatus>,
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
    pub content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub is_binary: bool,
    pub is_image: bool,
    pub old_image: Option<String>,
    pub new_image: Option<String>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub content: String,
    pub has_markers: bool,
}

/// Result of merge/rebase/cherry-pick style operations.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpOutcome {
    pub status: String, // "ok" | "conflicts" | "up_to_date" | "fast_forward"
    pub message: String,
}
