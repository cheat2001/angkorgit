# Changelog

All notable changes to AngKorGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **More languages in the diff highlighter.** Diffs for Less, SCSS, Dockerfiles,
  Makefiles, CMake, `.ini` / `.properties`, and `.editorconfig` pick up highlight.js
  grammars instead of rendering as plain text. Common aliases (`cts`, `pyi`, `mdx`,
  `kts`, …) and basenames (`Dockerfile`, `Makefile`, `CMakeLists.txt`) map to the
  right grammar. CSS selector token classes are coloured so style diffs are readable.

## [0.18.0] — 2026-09-24

The review release. AI can now review one file from its diff or a whole commit from the
inspector, with findings by severity, a verdict and quoted lines that jump to the code; the
answers no longer stop mid-sentence. Around it, a pass over the working copy and the commit
file list, push failures that explain themselves, self-hosted forges on custom domains, and
an embedded terminal that finally sees your login-shell PATH.

### Added
- **AI review and explanation for one file.** The diff header has a sparkle button with
  two actions, Explain changes and Review changes, for the file on screen: a working copy
  change (staged or unstaged) or a file inside a commit. The answer opens in a strip under
  the diff header, so the code keeps its full width; fold it to one line with the verdict, or
  open it in a full view. Every line the AI quotes is a link: click it and the diff scrolls
  to that line and highlights it. The strip can be stopped while it runs and is dismissed
  when you leave the file. The AI is told where the file sits and which other files changed with it, so code
  that moved to another file is not reported as missing. Reviews follow the same conventions
  as the staged review, including `.angkorgit/review.md`.

- **Review a whole commit with AI.** Commit details has Review with AI next to Explain
  with AI. The review covers the commit's full diff, knows the commit message and its file
  list, follows the same conventions as the other reviews, and lands in the same card with
  findings by severity and a verdict. Explain with AI gets the same context.

### Changed
- **Diff header fits narrow windows.** Word diff, line wrapping and whole-file view moved
  into one View options menu, the change and file counters no longer wrap onto a second
  line, and below about 960 px the header drops its labels and keeps the icons.
- **Sidebar headers keep their names.** Section actions only take room while you hover or
  focus the header, so a narrow sidebar no longer shortens "Worktrees" to "W…".
- **A calmer working copy.** File rows carry a small square change mark (M, A, D, R) instead of
  a round pill, in the working copy and in a commit's file list alike. The full-path tooltip
  opens under its row rather than over the graph. A divider separates Staged from Changes,
  an empty Staged section shows a small card saying how to fill it, Review is disabled with
  the same reason as Commit, and the Commit button shows its shortcut on hover.
- **A clean working tree is one card.** Instead of two empty sections and a stray Amend
  link, a clean repository shows a single "Working tree clean" card with Amend last commit
  inside it.
- **File rows show the folder that matters.** In the working copy and a commit's file list the
  dimmed directory now truncates from the front, so a long path ends with its nearest folder
  instead of a shared prefix. The open-diff chevron in a commit's file list appears only on
  the hovered or open row.
- **Working copy file menu.** Discard changes sits next to Delete file at the end of the
  menu, under one separator, so the two destructive actions are together.
- **Smaller things.** The uncommitted row wears a plain WIP chip instead of `// WIP`; the
  welcome page's search box says "Search repositories" and shows its keyboard hints beside
  it instead of inside a cut-off placeholder; file history shows a proper empty state when
  a commit did not touch the file; the pull request dialog's notes are hint rows with an
  icon and a tone, and a trunk branch such as main no longer pre-fills the title; the
  command palette shows ↑↓ ⏎ esc hints in a footer and ⌘R on Refresh; the lane colour band
  behind the graph is visible on light themes.
- **AI answers are written for reviewers.** Explanations come as What it does, Changes and
  Worth checking; reviews as Summary, Findings (Bug, Risk or Nit, quoting the exact line,
  what is wrong, how to fix it) and a Verdict. Both apply to the staged review and the commit
  explanation too. The answers render as real sections with Bug, Risk and Nit badges and a
  coloured verdict, in the strip, the staged review card and the full-view dialog alike.

### Fixed
- **Push no longer reports success when the server refused a ref.** libgit2 returns Ok even
  when the server rejects one ref, so a tag that already existed elsewhere still toasted
  "Pushed". The engine now collects the per-ref status and fails with the rejected refs
  named, git style. (#41)
- **A non-fast-forward push explains itself.** Instead of the raw libgit2 text, Push now
  opens a small dialog offering Pull with rebase (someone else pushed) or Force push (you
  rewrote pushed commits), each with a one-line explanation. Other callers get a plain
  sentence with the same two options. (#40)
- **Side-by-side blank bands no longer catch the caret.** The empty side of a paired row now
  carries an invisible anchor, so dragging a selection through it keeps going downward
  instead of jumping back up. Copy is unaffected. (#42)
- **Self-hosted forges on custom domains.** A remote host the substring rules do not
  recognise takes its forge kind from the account connected for that host, so a GitLab on
  code.example.com gets its merge request button, links and account. Hosts nothing knows
  show a "Connect code.example.com" hint in the status bar instead of nothing. (#32)
- **The embedded terminal gets the login-shell PATH and a UTF-8 locale.** The first
  terminal probes `$SHELL -ilc env` once (5 s cap) and applies that environment to every
  session, so Homebrew and friends resolve; LANG keeps an existing UTF-8 value and upgrades
  anything else (zh_CN to zh_CN.UTF-8, C to en_US.UTF-8), so CJK typed at the prompt echoes
  correctly. (#37)
- **AI answers stopped mid-sentence.** Every provider was capped at 1024 output tokens, and
  models that reason before answering (Gemini 2.5 among them) spent most of that budget
  before writing. Explanations, reviews, PR descriptions and summaries now get a 4096-token
  budget; commit messages keep the short one.

## [0.17.0] — 2026-09-22

The whole-tree release. The inspector can show every file at a commit, not only the
changed ones, a commit's file list filters by kind of change, the sidebar sections wear
the same gold tiles and count badges as the rest of the app, Push with tags works again,
and a dead remote no longer stops the others from being fetched.

### Added
- **All files view.** The Inspector's list and tree toggle has a third mode, All files,
  which shows every file at the selected commit (or in the working copy) as a folder tree
  with the changed ones marked. Folders without changes start collapsed, unchanged files
  open read-only in the centre with an "unchanged" badge, and changed files keep their
  diff, checkbox and menus.
- **Filter a commit's files by kind of change.** The M, A, D and R counts in a commit's
  Files header are buttons now. Click one to see only those files, and All brings the rest
  back.

### Changed
- **Sidebar sections are easier to tell apart.** Each section header (Branches, Worktrees,
  Merge requests, Remotes, Tags, Stashes, Submodules) now carries its icon in a small gold
  tile and its count in a badge, the same devices the rest of the app uses, so two open
  lists no longer run into each other and nothing needed a divider.

### Fixed
- **Selecting past the bottom of a diff.** Dragging a selection below the visible area used
  to fall apart once the view scrolled: copy returned one line and the highlight moved
  when you scrolled back. The selection now grows to the last visible line while you hold
  the mouse below the diff, and copy returns every selected line.
- **Push with tags failed** with `not a valid reference 'refs/tags/*'`. libgit2 does not
  expand the glob git uses, so the engine now names each local tag in its own refspec. (#34)
- **Fetch keeps checking every remote.** A failing remote no longer prevents the others
  from being fetched on later automatic runs. Partial results name the failed remotes,
  and the status bar keeps showing when a successful fetch or pull last happened.

## [0.16.0] — 2026-09-20

The quiet release. macOS stops asking for folder access every time you come back to
the window, a commit message you have not pushed yet can be fixed in place, and the
interface, the diffs and the terminal can use the fonts you already have. GitHub
Copilot CLI joins the installed AI providers, the GitHub account form finally
mentions fine-grained tokens, and "Show in file manager" on Windows opens the right
folder again. Christian Lauinger shaped this version with the Copilot provider and
the Windows report.

### Added
- **Choose your fonts.** Settings → Appearance has a Fonts card with three pickers over
  the fonts installed on your computer, each name shown in its own face: Interface for the
  whole app, Code for diffs, hashes and commit details, and Terminal, which follows Code
  unless you give it its own font and size. The preview line shows the terminal result,
  everything switches right away, the choice is remembered, and Reset fonts brings the
  defaults back. A font removed since you picked it says so instead of failing quietly,
  and the card links to Nerd Fonts for glyphs. (#28)
- **Fine-grained GitHub tokens, explained.** The GitHub account form keeps its classic
  token link and now adds the fine-grained token page next to it, with the two permissions
  it needs spelled out (Contents and Pull requests, read and write). Both kinds have
  always worked; the form just never mentioned fine-grained tokens, which left
  organizations that require them guessing. (#31)
- **Edit a commit message in place.** Select a commit you have not pushed yet and
  double-click its message in the inspector, or use the pencil button or the graph's
  right-click menu. The summary and description open as the same two fields as the
  commit box, the description opens at the height of the message and can be dragged taller,
  ⌘⏎ saves and Esc cancels. The latest commit is amended without touching
  your staged or unstaged changes; an older commit is rewritten together with the
  commits above it, which needs a clean working tree. Commits already on a remote keep
  the button disabled, and the change is undoable. Suggested by users who kept fixing
  typos with a manual amend.
- **GitHub Copilot CLI as an installed AI provider.** AngKorGit detects the
  `copilot` binary, including WinGet installs on Windows, and runs prompts through
  the user's existing Copilot login and quota with optional model overrides.

### Fixed
- **macOS stops asking for Desktop, Documents and Downloads access again and
  again.** The app bundle shipped without a code signature, so macOS could not hold
  on to the permission you granted and asked again the next time the app touched a
  repository in one of those folders, often several times in a row and every time
  you came back to the window. The bundle is now signed as a whole. macOS asks once
  per installed version and remembers the answer.
- **"Show in file manager" on Windows opens the file's folder again.** Explorer was
  handed a path with forward slashes, quoted as a whole together with its `/select`
  switch, and fell back to a default folder. Reported by Christian Lauinger. (#26)

## [0.15.0] — 2026-09-16

The upstream release. Add a remote from the sidebar, file a pull request from a
fork into its upstream, and clone into the folder you always use. SSH remotes on
Windows now accept the ed25519 and ECDSA host keys servers actually present, a
minified diff no longer freezes on macOS, and a text selection stays on its lines
while you scroll. Three contributors shaped this
version, two of them with their first pull requests to the project.

### Added
- **Add a remote from the sidebar.** The Remotes section header has a "+" and the
  empty state an "Add remote" button. Name it, paste the URL, and it is fetched right
  away so its branches appear. Remove was already there; add never made it in. (#26)
- **Pull requests from a fork into upstream.** When a repository has two remotes on
  the same host that point at different repositories, the create dialog gains an
  "Into repository" choice, pre-set to `upstream` when there is one. The target
  branch list, default branch and reviewers follow the chosen repository, and the
  request is filed there with the fork as its source on GitHub, GitLab and Bitbucket
  Cloud. (#26)
- **Default clone folder.** The clone dialog starts from the last folder you cloned
  into, and Settings → Git → Clone destination lets you pick or clear it. (#26)
- **Right-click menu in the terminal.** Copy, Paste, Select all and Clear terminal. (#26)

### Fixed
- **Fetch, pull and push over SSH on Windows.** The bundled libssh2 was built
  with the WinCNG crypto backend, which cannot negotiate `ssh-ed25519` or ECDSA
  host keys, so talking to servers like GitLab failed with "failed to set
  hostkey preference: The requested method(s) are not currently supported"
  before authentication was even attempted. The Windows build now compiles
  libssh2 against the vendored OpenSSL instead, which speaks every host-key
  type the git CLI does. Local Windows builds of the engine now need Perl on
  `PATH` (e.g. Strawberry Perl) for the OpenSSL compile; release CI already
  provides it.
- **A text selection in a diff stays on the lines you selected while you scroll.**
  Rows that leave the screen are unmounted by the virtualized diff, and the browser
  used to move the selection boundary to whatever row took that slot, so after a
  scroll the highlight sat on different lines. The selection is now tracked by line
  and column and put back on the right text after every scroll, and ⌘C copies the
  full selection even while the selected rows are off screen. Line numbers, change
  markers and hunk headers are no longer selectable, so a drag that crosses them
  keeps to the code.
- **Diffs with very long lines no longer freeze the scroll on macOS.** A minified
  bundle with lines of 50,000 to 300,000 characters used to stall the diff for up
  to a second per frame on WebKit while Chromium stayed smooth. Rows now render at
  most 5,000 characters, with a "… n more characters" tag on the clipped ones, and
  clipped rows skip syntax highlighting. On a synthetic copy of the reported file the
  worst frame went from 1.05 s to 51 ms and the diff opens in a third of the time.
  Copy still uses the full line text. (#27)
- **Horizontal scrolling in a diff stays responsive under load.** The pan of the two
  text layers is composited now instead of repainting every frame, and its scroll
  limit is measured once per gesture instead of on every wheel event, so a busy
  session no longer makes sideways scrolling lag while vertical scrolling feels fine.
- **A shorter titlebar on Linux under Wayland.** The windowing layer that Tauri
  pins puts its own full-height GTK header bar on the window, so GNOME users had
  an empty bar above the toolbar. It is now compacted to the size of its buttons.
  X11 and other desktops are unchanged. Thanks to Christian Lauinger. (#25)

### Changed
- Diff text renders without font ligatures. WebKit shapes ligature fonts on a slower
  path, which cost a factor of 3.5 on long minified rows, and a ligature can hide a
  one-character difference between two lines. Fewer rows are rendered off screen
  while scrolling (overscan 24 → 8), which shortens each scroll burst.

## [0.14.0] — 2026-09-13

The fork workflow release. Fast-forward from the branch menu, every remote fetched
on each tab switch, the repository page one click away, and the AI provider in the
status bar. Two testers filed six issues in two days and every one of them shaped
this version, including a blame crash on uncommitted edits and hunk staging that
only worked on the first hunk.

### Added
- **Fast-forward from the branch menu.** Right-clicking a branch in the sidebar or a
  branch chip in the graph now offers "Fast-forward current to this" next to "Merge
  into current". It is enabled only when the current branch is strictly behind, so
  syncing a fork's `main` with `upstream/main` is one click and leaves no merge
  commit. "Merge into current" keeps recording a merge commit. (#20)
- **AI provider in the status bar.** A chip next to the zoom control names the AI
  provider in use, Gemini, Claude Code, Ollama and so on, with its icon green when
  the last Test connection passed, red when it failed and plain when it has not been
  tested since the settings changed. Nothing is polled; only Test connection writes
  the result. With no provider set up it reads "Set up AI", and clicking it opens
  the AI settings either way. (#23)
- **Open the repository in the browser.** Right-click a remote in the sidebar for
  "Open in browser", or run "Open repository in browser" from the palette, and the
  repository page on GitHub, GitLab, Bitbucket or a self-hosted forge opens in your
  browser. Each remote opens its own page, so a fork's `origin` and `upstream` are
  both one click away. Bitbucket Server paths map to their browse page; a remote
  with a local path has nothing to open and the entry stays disabled. (#24)
- **Avatars from your connected account.** When Gravatar has nothing for an author,
  the graph, commit view, file history and blame ask the repository's forge instead:
  GitHub and Bitbucket by the commit, GitLab (self-hosted included) by the author
  email. Needs a connected account for that host and the Pull requests setting on;
  one request per author, cached for the session.

### Changed
- **Fetch reaches every remote.** Auto fetch, the toolbar Fetch and the palette's
  fetch now walk all remotes instead of the first one, so a fork sees `upstream`
  move without a manual fetch. (#18)
- **Zed and Flatpak editors are detected on Linux.** Zed's `zeditor` package name
  and the Flatpak exports of Zed, VS Code, Sublime Text, GNOME Builder and Kate are
  recognised by the External editor picker. (#18)
- **Editors are found in their default install folders.** On Windows the External
  editor picker looks in the usual install locations of VS Code, Cursor, Windsurf,
  Sublime Text and the JetBrains Toolbox scripts even when their launcher is not
  on PATH; macOS and Linux add the JetBrains Toolbox scripts folder.

### Fixed
- **Blame no longer crashes on a file with uncommitted changes.** Blaming the working
  copy of a tracked file you had edited aborted the whole app: libgit2 splits a
  committed block around your edit and leaves the split halves without a signature,
  which the engine then dereferenced. Authors now come from the commit itself. (#21)
- **Blame knows when there is nothing to blame.** An untracked or newly staged file
  has no commits, so the Blame entry in the file menu and the diff header's Blame
  button are disabled with a hint instead of erroring, and the engine says so plainly
  for a path missing from a commit. (#21)
- **Stage hunk works on every hunk, not only the first.** Staging or unstaging a
  later hunk in a file with several changes failed with "hunk did not apply": the
  isolated hunk kept line numbers from the full diff that libgit2 could not match.
  The hunk is now anchored on the lines the index actually has. (#22)
- **Remote branch tooltips say what double-click does.** A remote branch row or
  chip used to promise "double-click to checkout"; it now says the local branch is
  checked out from it and fast-forwarded when it is behind, which is what happens.
  (#20)
- **Switching tabs fetches again.** The fetch that runs when you open or switch to a
  repository tab fired before the repository's remotes were loaded, found none and
  gave up until the next auto fetch interval. It now waits for the remote list, so
  the status bar's "Fetched just now" is true right after a tab switch. (#20)
- The commit and working copy file menus said "Show in Finder" on Linux and
  Windows; they say "Show in file manager" there. (#18)
- On Windows the command line tool installed into a folder that was never on PATH,
  so `akg` could not be found. Install now adds that folder to the user PATH and
  uninstall removes it. On macOS, when the install falls back to `~/.local/bin`,
  the Settings card says how to put it on PATH.

## [0.13.0] — 2026-09-12

The terminal and editor release. `akg` opens or clones a repository from the shell,
your editor opens from AngKorGit, blame joins file history with a commit list to
travel through, and pull finally follows your rebase setting. Two community reports
and one pull request shaped it.

### Added
- **Open or clone a repository from the terminal.** Settings → Git (or the command
  palette) installs an `angkorgit` command with a short `akg` alias. `akg` and
  `akg open [path]` open a local folder; `akg clone [-b branch] <url>` opens the
  clone dialog with the URL, folder and branch filled in. `akg --help` lists the
  commands.
- **Blame.** File history now has a Diff / Blame toggle. Pick a commit on the left
  and the blame pane shows the file as it was then, every line with who changed it,
  when, and in which commit; a "Working copy" row at the top blames the file on
  disk with uncommitted lines marked. Open it from the diff header, from a file's
  right-click menu in the working copy or a commit, or from the palette with
  "Blame…". Hover a line to light up every line from the same commit, click the
  author to jump to that commit in the graph, and right-click to blame the file at
  that commit or just before it.
- **Open in your editor.** Settings → Git lists the editors installed on your
  machine (VS Code, Cursor, Zed, Sublime Text, the JetBrains IDEs, Xcode, GNOME
  Builder and more). The toolbar gets an "Open in <editor>" button whose menu
  offers every detected editor, the palette has "Open repository in <editor>",
  and file rows in the working copy and the commit view open a single file.
- **Pull with rebase.** Pull now follows `pull.rebase` from your git config, so a
  `rebase = true` setup gets a linear history like it does in the terminal. The
  Pull button has a menu to pick merge or rebase for one pull, and the palette
  has "Pull with rebase".
- **The status bar says when the repository was last fetched.** Switching to a
  tab already fetched its remote, but nothing showed it. "Fetched 2m ago" now sits
  next to the branch, and hovering it tells you the exact time and how often the
  auto fetch runs.
- **Right-click on a commit's files.** Files in the commit view now have the same
  menu as the working copy: edit, file history, open in an external app, show in
  Finder, copy the relative or the absolute path. Stash files keep their Apply
  entries at the top.
- **Crowded ref columns expand on hover.** When a commit carries more refs than fit
  next to it, hovering its chips (or clicking the `+n` badge) stacks every branch and
  tag in place, one per line, as real chips: double-click to check out, right-click
  for the same menu a visible chip gets. That menu also offers "Reset … to this…" on
  a remote chip whose local branch has drifted ahead, so a folded origin ref can be
  reset from there.
- **Pull requests are checked for tool-generated commit trailers.** A CI job fails
  when a commit carries `Co-authored-by` lines from coding tools or a "Generated
  with" footer, and the contributing guide says so.

### Security
- react-router-dom 6.30.6, fixing an open redirect in `<Link>` and `useNavigate`.

### Fixed
- **The checked-out branch is always the visible chip.** When several local
  branches sit on the HEAD commit, the graph used to show whichever came first and
  gave it the tick, so the branch you were actually on could hide behind `+1` while
  its neighbour looked checked out. The current branch now sorts first and is the
  only one marked.
- **↑/↓ in the working copy list now move the diff.** After clicking a changed
  file, the arrow keys only moved the highlight and the diff stayed on the file you
  clicked. They now open the previous or next file, like the commit file list.
- **Cloning from inside a repository opens the clone.** The Clone entry in the
  repository switcher used to finish with a toast and leave you in the repository
  you started from. The new one now opens in its own tab.
- **Pushing a branch that is already up to date no longer pushes.** The toolbar
  Push, ⌘P and the branch menu used to send the push anyway and toast "Pushed
  <branch>", so hosts that react to every receive-pack started CI for nothing.
  When the tip matches the remote-tracking branch AngKorGit now says the branch
  is already up to date and never contacts the remote, like `git push` (#17).

## [0.12.0] — 2026-09-10

The find and fix release. Searching the graph now finds instead of filters, so
the lanes stay put while you step through matches by message, hash or author. The
conflict resolver was rebuilt around how people actually use it: predictable pick
order, a keyboard, one file flowing into the next, and nothing lost to a stray
Escape. A branch tip pushes from its own menu, a file's history opens the whole
commit, and the first community reports are fixed: Linux tokens survive a restart,
reconnecting an account works, and the panels stop where they should when dragged.

### Changed
- **Conflict resolver, reworked around how people actually use it.** Picked lines
  now land in the result in file order (all of A, then all of B) no matter which
  you clicked first. A conflict's side checkbox shows a dash while only some of its
  lines are taken, each conflict header says "resolved" or "edited by hand", and
  unresolved blocks in the result carry a small "Conflict n · unresolved" tag so a
  dimmed preview is never mistaken for a choice. The split between the two sides
  and the result is draggable. The keyboard works: ↑/↓ move between conflicts, A
  and B take a whole side for the current one, ⌘⏎ marks the file resolved, Escape
  closes. Marking a file resolved opens the next conflicted file by itself (a file
  switcher in the header lets you jump around), and the last one tells you how to
  finish the merge, rebase or cherry-pick. Hovering "current" and "incoming"
  explains which side is which, including the swapped meaning during a rebase.

- **Search finds, it no longer filters.** Typing in the commit search keeps the
  graph exactly as it is and jumps to the first match. A "n of m" control next to
  the box steps through the matches (Enter and ↓ forward, Shift+Enter and ↑ back),
  every match carries a thin marker on its left edge, the active one glows, and
  Escape clears the search. Hashes, prefixes and message text all go through the
  same search, so "Commit not found" is now simply "No matches". Clicking another
  commit keeps the search so you can carry on stepping. The author box works the
  same way, alone or together with the text, so the graph never collapses into a
  flat list any more.
- **Push from the graph.** Right-clicking the tip commit of a local branch offers
  "Push <branch>" with the ahead count, using the branch's upstream remote. The
  branch chip's own Push entry now goes through the same flow, so a repo-bound
  profile is applied first, as it is from the toolbar.

- **Open the whole commit from a file's history.** Each row in the file history
  panel has an open-commit button on hover, a right-click menu, and responds to
  double-click: the panel closes and the graph jumps to that commit with all of its
  files in the inspector. (#9)

### Fixed
- **Linux: tokens now live in the desktop Secret Service** (GNOME Keyring, KWallet)
  instead of the kernel keyring, which forgot them between sessions. Accounts whose
  token is gone are flagged "Token missing from the keychain" with a Reconnect
  button as soon as the check runs, and pull request loading says the token is
  missing rather than claiming no account is connected. Building on Linux now needs
  `libdbus-1-dev`. (#7)
- "Reconnect with a new token…" on an account did nothing when the account form was
  hidden. It now opens the form prefilled with the provider, host and username and
  puts the cursor in the token field. (#8)
- Closing the conflict resolver, switching files or pressing Escape with picks or
  hand edits in progress used to drop them silently. It now asks first, and the
  hand-written whole-file result can no longer be discarded with one stray click.
- ⌘⏎ and ⌘Z inside the conflict resolver reached the commit box and repo undo
  underneath it.
- The inspector could be dragged past its minimum width until it vanished, with no way
  to bring it back short of switching repositories. It now stops at its minimum; only
  file history still folds it away, and it returns at the width it had.
- Dragging the sidebar shut and then back open in the same gesture left an empty
  column where the sidebar should be until the toggle button was pressed.

## [0.11.0] — 2026-09-07

The working-copy release. Stashes become first-class: stash only the files you
pick, see every stash as its own row in the graph, and apply single files back
without popping the whole thing. The working copy learns multi-select, discard
for staged files and a path filter, the diff follows your editor as you type,
and the keyboard carries you from the graph into a commit's files and back.
The branch you stand on is unmistakable in the sidebar and the graph, a stale
local branch fast-forwards when you check out its remote, and the sidebar no
longer starts hidden after a relaunch.

### Added
- **Filter files by path.** A search icon in the inspector header opens a filter
  box above the working copy lists or a commit's file list. Type part of a path
  (several words narrow it further, case does not matter) and only matching
  files stay, with an "n of m" count in each header. Escape clears it, then
  closes it. The box takes focus only when you open it, never when the panel
  redraws, so the graph keeps its arrow keys. (#5)
- **File history from the diff.** The diff header carries a history button, so the
  file you are reading is one click away from every commit that touched it — no
  detour through the file's menu or the command palette.
- **Reset a branch to its remote in one click.** When a local branch and its
  remote have drifted apart, their chips sit on different commits in the graph.
  Double-clicking the remote one now asks whether to move the local branch onto it with
  a hard reset — naming the commits that would be lost — or cancel. A branch that
  is not checked out is checked out first, and both steps can be undone. The
  prompt only appears when the local branch has commits of its own; a branch
  that is merely behind is checked out and fast-forwarded instead.
- **Stash selected files.** Right-click a file in the working copy and pick
  "Stash this file…", or shift-click / ⌘-click several files and stash, stage,
  unstage or discard them together from the same menu. The dialog lists the
  files and everything else stays in place. Works for staged, unstaged and
  untracked files, and the stash holds exactly those files even when other
  files are staged. Popping a stash also works while other changes are staged.
- **Restore single files from a stash.** Click a stash in the sidebar and its
  files appear in the inspector, untracked ones included. Tick the files you
  want (shift-click for a range, or Select all) and apply them together, or
  right-click a single file and apply just that one. The stash itself stays put, so the
  rest is still there when you need it.
- **Discard staged files too.** Staged rows now carry the same hover discard
  button as unstaged ones, and the row menu and the multi-select menu offer it
  as well. Each list header keeps its primary action and a quiet trash icon
  for "Discard all", which asks before touching anything. Discarding a staged file puts
  it back to the last commit, index and working copy alike; a newly added file
  is removed.
- **Stashes in the graph.** Each stash now appears as its own row next to the
  commit it was taken from, with an archive icon in place of the avatar and a
  dashed chip carrying its message. Click the row to see the stashed files,
  right-click the row or the chip to apply, pop or drop it.
- **Keyboard flow from graph to diff.** With a commit selected, → opens its
  first file in the diff view and moves focus to the file list, ↑/↓ step through
  the files, and ← closes the diff and puts you back on the same commit in the
  graph. The working copy list answers the same keys.
- **Lane color band is optional.** The Graph display menu gets a "Lane color
  band" switch, on by default, for anyone who prefers a plainer graph.
- **Pop from the toolbar.** A pop button sits beside the stash button. Its
  tooltip names the latest stash and one click restores it. The command palette
  gets the same "Pop latest stash" entry.

### Changed
- The lane-colored band behind each commit avatar now ends on a soft rounded
  edge instead of fading into nothing.
- The branch you are standing on is now unmistakable: the sidebar row carries the
  accent tint, a gold bar on its left edge and a bolder name, and its chip in the
  graph is filled solid instead of tinted like every other branch — no more
  hunting for the tick.
- **Checking out a remote branch brings your local branch up to date.** When a
  local branch of the same name already exists and is simply behind the remote,
  checkout now fast-forwards it to the remote's commit (and sets the upstream if
  it was missing) instead of silently switching to the stale local branch. A
  local branch with its own commits is left alone, as before.

### Fixed
- The file summary above a commit's file list stays on one line, as colored
  marks with counts, instead of wrapping when a commit touches files in every
  way at once.
- **The sidebar no longer starts hidden after a relaunch.** Quitting with a diff
  open saved the folded sidebar layout, and on the next launch that layout was
  mistaken for you closing the sidebar. It now reopens as you left it, and only a
  real drag on the divider counts as closing it.
- **The diff view follows your editor.** Editing a file that is open in the diff
  view (or staging a second hunk of it) now refreshes the diff in place as soon
  as the change lands on disk. Before, the diff only reloaded when the file's
  status kind changed, so you had to open another file and come back.

## [0.10.0] — 2026-09-05

The parallel-work release. Worktrees arrive as a first-class feature, so two
branches can live in two folders with their own graph, working copy and
terminal, and an AI agent can work in one while you keep going in the other.
Around it, a long polish pass: a calmer conflict resolver with line numbers
and in-place editing, an accordion sidebar with real empty states, graph
display options, a redesigned Settings, a commit box with summary and
description, and a welcome page that behaves like the rest of the app.

### Added
- **Worktrees.** A Worktrees section in the sidebar lists every working tree of
  the repository, main first, with its branch, an uncommitted-changes dot, a
  lock mark and a warning when the folder is gone. Click a row to open that
  worktree as its own tab. "New worktree…" (sidebar, command palette, a branch's
  "Open in new worktree…" or a commit's "New worktree from here…") creates a
  sibling folder named `<repo>-<branch>` on a new or existing branch and opens
  it. Removing confirms first, refuses a dirty folder unless you opt into
  deleting the changes, and a prune action forgets entries whose folder was
  deleted outside the app. Branches checked out in another worktree carry a
  marker in the Branches list and in the graph; checking them out switches to
  that worktree instead, because git allows one folder per branch.
- **Accordion sidebar.** Open sections take the room and scroll inside
  themselves, collapsed sections stay visible as slim headers pinned above or
  below, and short sections only take the rows they need. A collapse-all
  button beside the ref filter (and a palette command) folds everything, and
  sections remember whether you left them open.
- **Sidebar empty states.** Worktrees, Tags, Stashes and Remotes show a small
  card with one line and the relevant action instead of grey text.
- **Graph display options.** A menu in the graph header toggles branches and
  tags, commit message, an author name column, hash and date, remembered
  across launches, and a slim header row names each column.
- **Line numbers in the conflict resolver.** The A pane, the B pane and the
  Result each carry a gutter. A and B count through their own version of the
  file; the Result counts the file you are about to write and follows your
  picks and edits.
- **Commit box with summary and description.** Two fields in one group, styled
  like the commit shown in the inspector: Enter moves from the summary to the
  description, Backspace in an empty description goes back, ⌘⏎ commits from
  either, and the 50/72 counter sits on the summary line. The box is
  resizable from its top edge and remembers its height. Under the hood it is
  still one message, so drafts and generated messages keep working.
- **Welcome page.** Recent repositories are rows with an icon, a home-relative
  path, the time, and a menu with Open, Reveal in Finder, Copy path and Remove.
  Moved or deleted folders are marked "folder missing" instead of failing. The
  search box has focus on arrival and the arrow keys and Enter open a
  repository. A fresh install gets an empty state with Open and Clone, and the
  version with a "Check for updates" link sits in the footer.
- Click a hash in the graph to copy it; hover a relative time for the full
  date. An empty filtered graph offers "Clear filters".

### Changed
- **Conflict resolver.** Color is an accent, not a wash: thin colored edges
  instead of tinted panes, tint only on picked lines, a slim colored bar
  instead of bold letters in the Result. Each side of a conflict has one
  checkbox on its middle line that takes the whole side; other lines show a
  plus on hover and a tick once taken. Editing the Result happens in place,
  with the caret on the line you clicked and the line numbers following. The
  header shows the file with a progress bar, the A and B headers say current
  and incoming, blocks are numbered, the conflict navigation sits in the
  Result header, and the resolver opens as a solid editor surface.
- **Conflicts in the working copy** are their own section above Changes, in
  the same style as Changes and Staged, and conflicted files no longer appear
  a second time in the Changes list.
- **Settings.** Single controls sit on their title row. Profiles are cards with
  an avatar, an "In use" badge, a Use button, a confirmed remove, and a tidy
  list of linked accounts with a switch per account; adding a profile is a
  labeled form. Accounts are readable cards with a menu and a labeled connect
  form behind an "Add account" button; the credential-helper switch has its own
  row. The AI tab reports Reachable or Not reachable beside Test connection,
  shows detected CLI agents as cards, and lays prefix rules out as a small
  table. The card, field, row and empty-state primitives are shared by every
  tab.
- **Commit details** in the inspector: the close button moved into the panel
  header, long bodies fold behind "Show full message", author, time, hash,
  parents and refs share one card with the graph's ref icons, and the file list
  uses the working copy's letter badges and plain rows. Tree view has a fold
  button in each list's own header.
- **Graph.** Ref chips show whole labels inside a fixed column and fold the
  rest behind "+n"; a HEAD chip appears only when detached. Lanes are wider
  and compress evenly on busy histories so the graph column never grows past a
  fixed width. Commit nodes have a double ring and a soft lane-colored band
  toward the message. Merge commits read one shade quieter. Jumping to a
  commit lands with a short settle animation and a gold edge.
- **Every sidebar row** answers both the hover menu button and right-click
  with the same actions, including stashes, tags, pull requests and
  submodules. Each remote's folder row carries the remote actions; the
  separate list of remotes is gone.
- File rows in the working copy and commit details keep the file name whole
  and truncate the folder path first.
- Checking out a branch that another worktree holds is refused with a message
  naming that folder, matching the git CLI.

### Fixed
- Multi-line comments in diffs are highlighted as comments all the way
  through, and a `/*` glued to a word, such as the JSX text `feature/*`, no
  longer turns the rest of a diff into a comment.
- The terminal panel follows the app theme and accent instead of a fixed navy
  background, and updates live when the theme changes.
- The inspector keeps one width when a diff folds the sidebar away.
- The commit box keeps its resized height when switching repository tabs.
- The file watcher follows a linked worktree's own HEAD and index and the
  shared refs, so a worktree tab refreshes on commits made from a terminal or
  an AI agent in that folder.

## [0.9.0] — 2026-09-02

The backport release. Cherry-picking grew up: pick one commit or a whole
selection in one motion, and let every new commit carry git's standard
"(cherry picked from commit …)" reference so scripts and teammates can trace
where a change came from — written exactly as git itself writes it.

### Added
- **Cherry-pick can record its origin** (#4) — cherry-picking from the graph
  now opens a small dialog showing the commit, and a "Reference the source
  commit" option appends git's standard
  `(cherry picked from commit …)` line to the new message, exactly as
  `git cherry-pick -x` writes it (verified byte-for-byte against the git CLI,
  including trailer-block placement for messages ending in `Signed-off-by:`
  style footers). The choice is remembered across sessions, and the dialog
  confirms the pick with Enter or a click.
- **Cherry-pick several commits at once** — select multiple commits in the
  graph and the context menu offers "Cherry-pick N commits onto current
  branch". The dialog lists every commit, applies them oldest first, and each
  one gets its own origin reference. If a commit conflicts, the run stops
  there and tells you how many were applied and how many are waiting, so you
  can resolve, commit, and pick the rest.

## [0.8.0] — 2026-09-01

The fast release. AngKorGit now gets out of your way: launch lands on your
repositories in a fraction of the old splash time, half the code waits until
you actually need it, and the app stays quiet while you work in your editor.
A long list of paper cuts went with it, from text selections lost to the
right-click menu to avatars that vanished after viewing a diff, and short
commit hashes now jump straight to their commit.

### Changed
- **The app starts as soon as it is ready** — the splash screen now waits for
  the app, not a timer: launch lands on your repositories in a fraction of the
  old fixed two seconds, and with reduce motion enabled the splash is skipped
  entirely. The window's native background also matches the default theme, so
  launching no longer flashes the wrong color.
- **Half the code loads at startup** — the terminal emulator, the conflict
  resolver and the repository view now load on first use instead of at launch
  (the startup bundle dropped from 1.26 MB to 0.58 MB), and demo-mode data no
  longer ships in the desktop app at all.
- **The app stays quiet while you work elsewhere** — a file save no longer
  triggers ahead/behind computations for every tracking branch on every
  watcher tick; an open diff no longer refetches and re-renders on every tick;
  and selecting a commit ships a lightweight file list instead of the whole
  commit's diff text (the full diff loads per file, on demand).
- Typing a commit message no longer re-scans the changed-file list on every
  keystroke, the sidebar filter is debounced and capped, the command palette
  mounts at most 100 branch items, and the file history's commit list is
  virtualized.
- Graph reloads after a commit or watcher event keep the loaded pages and
  scroll position, and jumping to a commit hash fetches the target window in
  one request instead of paging sequentially.

### Fixed
- The commit actions no longer overflow a narrow working copy panel: with the
  merge-only "Abort merge" button present (or a wide "Commit N files" label),
  the Commit button was clipped at the panel edge — the action row now wraps
  onto extra lines instead.
- Searching a short commit hash (down to git's 4-character minimum, e.g. one
  copied from GitLab or GitHub) now jumps to the commit in the full graph the
  same way a full hash does, instead of switching to a filtered list. A short
  hex string that matches no commit falls back to plain text filtering, so
  searches like "added" keep working.
- Avatars no longer disappear from the graph after opening a diff and coming
  back: images restored from the browser cache could finish loading before
  their load handler attached, leaving them permanently transparent until the
  repository was reopened.
- Selected text in a diff no longer loses its highlight when the right-click
  menu opens: the selection stays visible while the menu is up and is restored
  after it closes, in the diff view and the file history view alike.
- Pressing Escape with a context menu open now closes only the menu — it used
  to also close the diff, editor or conflict view underneath it.
- Enter in confirmation dialogs now activates the confirm button instead of
  silently cancelling, and Enter submits the create tag, stash, rename branch,
  edit remote and clone dialogs (with double-submit guards).
- Switching repositories no longer shows the previous repository's branches,
  status and file lists while the new one loads; opening a repository from the
  welcome screen shows progress on the row. When a switch takes longer than a
  moment, the content area shows a themed loading overlay with the Angkor logo
  drawing itself and the repository's name — fast switches stay instant and
  never flash it.
- A failed history, commit, diff, file-history or file-list load now shows a
  visible error with a retry button instead of rendering as an empty state;
  a shell that fails to start writes the error into the terminal pane instead
  of leaving it blank.
- ⌘⏎ commits from anywhere, Esc closes the editor, the diff, the file history
  and the conflict resolver (which now also takes focus on open), and the
  working-copy file list is keyboard-navigable (arrows, Enter, Space).
- Reduce motion now disables all transitions and animations, including the
  splash logo draw and smooth scrolling in the diff minimap and conflict
  resolver.
- Long paths and branch names no longer push buttons out of the conflict
  resolver header, terminal bar, welcome rows and sidebar; empty sidebar
  sections say so instead of rendering a blank body; hover-only row actions
  become visible when focused with the keyboard.
- Accounts re-checks run in parallel and show an explicit "could not check"
  state instead of silently keeping the last known one, AI provider keys are
  migrated to the keyring once instead of on every launch, and checking for
  updates shows a pending toast.

## [0.7.0] — 2026-08-28

The pull request release. AngKorGit now closes the loop between your local
branches and the forge they live on: open pull requests appear in the sidebar,
check out locally in one move, and new ones are created from inside the app
with reviewers attached, on GitHub, GitLab and Bitbucket Cloud alike. The
commit search also learned the move everyone expects: paste a hash and the
graph takes you straight there.

### Added
- **Pull requests in the app** — a new sidebar section lists the open pull
  requests (GitHub, GitLab, Bitbucket Cloud) for the current repository's
  remote, using the hosting account already connected in Settings →
  Authentication. Each entry shows its number, title and draft state; the row
  menu checks the pull request out locally (same-repo branches get proper
  tracking, fork PRs land on a `pr/<number>` branch via the forge's pull
  ref), opens it in the browser, or copies its URL.
- **Create pull requests without leaving AngKorGit** — the status bar button,
  palette command and sidebar "+" now open an in-app dialog when a connected
  account matches the remote: pick the target branch (pre-selected from the
  forge's default branch), write or AI-generate the description, optionally
  mark it as draft, and the created pull request opens with one click.
  Without a connected account the button keeps opening the pre-filled
  browser page as before.
- **Request reviewers while creating** — the create dialog lists the
  repository's members (GitHub collaborators, GitLab project members,
  Bitbucket workspace members) in a multi-select with their avatars, and the
  chosen people are asked for review as part of creation. Your own connected
  account is left out of the list, and the member list is remembered for the
  session so reopening the dialog is instant.
- New Settings → Git toggle "Pull requests": turn it off to hide the sidebar
  section and stop fetching pull requests entirely, for people who don't use
  them. The create button then falls back to the pre-filled browser page.
- **Searching a commit hash jumps to it in the graph** — pasting a hash (7 to
  40 hex characters, short or full) into the commit search no longer filters
  the view down to that single row: the graph loads up to the commit, scrolls
  it to the center, selects it and marks it with a highlight, so the commits
  around it stay visible. Clicking any other commit clears the highlight and
  the search box, Enter re-runs the jump, and a hash that doesn't exist keeps
  the graph untouched with a small "Commit not found" note instead of
  emptying the view. Text searches still filter as before, and ⌘F focuses
  the commit search whenever no diff is open (a diff keeps its find bar).

### Fixed
- With many repository tabs open, the tab bar's horizontal scrollbar covered
  the bottom half of the tabs. The scrollbar is hidden now (the strip still
  scrolls), the mouse wheel scrolls the tabs, and the active tab scrolls
  itself into view.

### Changed
- Forge API calls run through the Rust engine, which attaches the connected
  account's token from the OS keychain — tokens never reach the webview, and
  requests are only allowed to the remote's own host (or its api subdomain).
- Repositories with several remotes talk to the right forge: the pull request
  list and create dialog follow the current branch's upstream remote (falling
  back to `origin`), instead of whichever remote happens to be listed first.
  GitHub validation errors now spell out the failing field, so "Validation
  Failed" on a branch that only exists on another remote explains itself.
- Every forge loading state shows the AngKorGit mark drawing itself, matching
  the AI panels.
- A pull request list that cannot be fetched shows one short line ("Could not
  reach <host>, check your network or VPN") with click-to-retry, instead of
  dumping the raw request error into the sidebar; the full detail stays in the
  row's tooltip. Self-hosted GitLab instances served over plain http work now:
  when https fails at the transport level, read requests retry over http (the
  same way account verification already does) and the working scheme is
  remembered; writes never retry, so a merge request can't be filed twice.
- Switching repository tabs no longer flashes a loading state in the pull
  requests section: each repository's list is cached for the session, shows
  instantly on return, and refreshes quietly in the background when stale.
- Create dialog polish: Enter on the title (or ⌘Enter in the description)
  creates the pull request, an empty target branch list explains that a fetch
  is needed instead of silently disabling the button, and double-clicking a
  pull request in the sidebar checks it out — the same gesture branches use.
  Bitbucket lists are now ordered by most recently updated like the others.

## [0.6.6] — 2026-08-23

The review release. AngKorGit now gives your staged changes a second pair of
eyes: one click asks your AI for a real code review, shaped by your team's
conventions, running in the background while you keep working, and stoppable
the moment you change your mind. AI answers everywhere got the same care: a
full-size reading view, proper formatting, and the AngKorGit mark drawing
itself while you wait.

### Added
- **AI review before you commit** — a Review button next to Commit asks your
  configured AI to look over the staged diff and lists concrete issues (bugs,
  edge cases, missing tests) ordered by severity, in a dismissible panel above
  the commit box. Long reviews open in a full-size reading view with one
  click, and bold or code formatting in the AI's answer renders properly
  instead of showing raw markers. While the AI works, the panel shows the
  AngKorGit mark drawing itself alongside rotating status notes, with a stop
  button if you change your mind. Reviews and commit explanations keep
  working in the background: click around the graph while one runs and the
  result is waiting when you come back. Explanations open in the same
  full-size reading view as reviews, and every AI action shows the AngKorGit
  mark while it thinks — and every one of them can be stopped mid-flight if
  it takes too long. Works with every provider the commit
  message generator supports, including local CLI agents and Ollama. The
  review never blocks anything: it is advice, the commit stays yours.
- **Your conventions, the AI's checklist** — tell the reviewer what your team
  cares about in Settings → AI (naming rules, framework do's and don'ts, how
  strict to be) and it applies everywhere. For per-project rules, commit an
  `.angkorgit/review.md` to the repository: its content is picked up
  automatically for that repository and shared with everyone on the team,
  and project rules win over your global ones when they disagree.

### Fixed
- **Silent empty AI responses** — when an OpenAI-compatible or Ollama
  provider answered with empty content (some reasoning models leave the
  content field blank), AI features quietly produced nothing: no commit
  message appeared and the review panel showed up empty. Empty responses
  now surface as a proper error instead.

## [0.6.5] — 2026-08-23

The signing release. Commits made in AngKorGit finally carry your signature:
if your git config says sign, the app signs — SSH or GPG, the same key and the
same rules as your terminal, with nothing to set up in the app. Alongside it,
the AI settings grew a real model picker and the repository switcher learned
to scroll.

### Added
- **Commit signing** — commits, amends and merge commits made in AngKorGit now
  honor your existing git signing setup with no configuration inside the app:
  if `commit.gpgSign` is on, the engine signs with your SSH key
  (`gpg.format=ssh`, via `ssh-keygen -Y sign`) or GPG key (via `gpg`), reading
  `user.signingKey`, `gpg.program` and `gpg.ssh.program` exactly like git does.
  Signing failures block the commit with an error that names the actual cause
  (missing key, passphrase needs ssh-agent, gpg needs a graphical pinentry)
  instead of hanging or silently committing unsigned.

### Fixed
- **Repository switcher with many repos** — the dropdown grew past the bottom
  of the window with no way to scroll, hiding repositories and the "Open
  repository…" action. The repository list now scrolls inside the menu while
  the open/clone/profile actions stay pinned and always reachable.
- **Pick AI models from a list** — the AI settings no longer make you type
  model names from memory: a "Load models" button fetches what your API key
  (and custom base URL) can actually access — OpenAI-compatible endpoints
  including Groq, Ollama and LM Studio, plus Anthropic and Gemini — and shows
  them as a click-to-select list. The field stays editable, so custom and
  self-hosted model names keep working.

## [0.6.4] — 2026-08-21

The tidy-up release. Long file paths stop escaping their popups and start
reading properly, hovering any file shows you where it actually lives, opening a
diff gives it the full window, and the branch list finally forms a straight column
instead of nudging the checked-out branch sideways.

### Added
- **Hover a file to see its full path** — working-copy rows had no tooltip at
  all, so a path that truncated gave you no way to read the rest of it; commit
  file rows only had the plain system tooltip. Both now show the app's own
  tooltip with the complete path, placed beside the row rather than over it, so
  it never covers the file you are about to click.

### Changed
- **Opening a diff gets out of its own way** — the branch sidebar now folds away
  when you open a diff, giving the file the full width, and toggling the sidebar
  back on always closes the diff and returns you to the graph, whether the diff
  hid the sidebar or you had already hidden it yourself.
- **Confirmations show the path in its own panel** — the file path used to be
  quoted inside the sentence (and inside the "Delete …?" heading), which turned
  a deep path into a three-line title broken mid-word. Titles are short again
  and the path sits in a monospace panel below, wrapping at directory
  boundaries with the folders dimmed and the filename bright.
- **Branch names line up in the sidebar** — the checkmark on the checked-out
  branch used to sit inline and shove that one name to the right, so a branch
  folder read as a ragged list. The tick now lives in its own fixed slot at the
  left, which also lines every branch name up with the folder name above it.

### Fixed
- **Long file paths no longer bleed out of confirmation dialogs** — discarding
  a change to a deeply nested file showed the path running straight past the
  edge of the "Discard changes?" popup, because a path has no spaces to wrap
  at. Both the title and the body of every dialog now wrap anywhere in a long
  word, so the whole path stays inside the box — this also covered the
  "Delete <path>?" confirmation, which had the same fault (#2).

## [0.6.3] — 2026-08-20

The quiet release, for Windows. Fetching, pulling and pushing no longer flash
a terminal window across your screen and pull the keyboard out from under
whatever you were typing in — the small helper processes the app runs now stay
properly invisible.

### Fixed
- **Windows: no more console window flashing during remote operations** — on
  Windows, fetching, pulling, pushing or letting auto-fetch run would flash a
  PowerShell/terminal window on screen for a moment and steal keyboard focus
  from whatever you were typing in. Every helper process the app runs (the
  `git credential` handshake, `ssh-keygen`, the AI CLI probes, open/reveal in
  file manager) is now launched with `CREATE_NO_WINDOW`, so it stays invisible
  (#1).

## [0.6.2] — 2026-08-18

The right-there release: clicking a file now drops you directly on its first
change — no scroll animation, no travel from the top — and long file paths
truncate their folders instead of their filenames, so the part you actually
read always stays visible.

### Changed
- **Diffs open directly at the first change, no scroll animation** — clicking
  a file used to animate the scroll from the top of the diff down to the
  first change; the diff now simply appears already positioned there,
  GitKraken-style. The prev/next-change buttons (`N`/`P`) keep their smooth
  glide, since there the motion shows where you jumped.

### Fixed
- **Commit file lists keep the filename visible** — long paths in a commit's
  file list used to truncate from the right, cutting off exactly the part
  that matters (`Shop/Main/dbo/Stored Procedures/Order…`). The directory now
  truncates instead, dimmed GitKraken-style, so the filename always shows in
  full (`Shop/Main/dbo/Stored…/Orders_ApplyCustomerStatus.sql`),
  matching how the working-copy list already renders paths.

## [0.6.1] — 2026-08-17

The resolving release: the conflict resolver becomes a direct-manipulation
editor — click any result to edit it in place, take whole sides per conflict,
navigate with a GitKraken-style pill that keeps both panes in sync — merges
can be aborted right where you commit, and diffs open on the first change
instead of the top of the file.

### Added
- **Per-conflict hand editing** — click any conflict's result in the Output
  pane (resolved or not) and it turns into an inline editor: unresolved
  conflicts prefill both sides so the code can be aligned/merged, resolved
  blocks prefill the picked lines. Edits apply live as you type, Esc cancels
  the typing, clicking away keeps it, and nothing touches the disk until
  "Mark resolved". Edited lines carry a pencil marker, count toward the
  resolved total, and a hover undo button discards an edit back to the
  checkbox picks; the whole-file editor behind the header pencil still works
  as before.
- **Per-conflict "Take all A" / "Take all B"** — each conflict block carries
  its own take-a-whole-side checkboxes, so one click resolves that conflict
  without ticking line by line (the pane-header checkboxes still take a side
  for every conflict at once).
- **Abort merge next to the commit button** — during a merge the commit box
  shows an "Abort merge" button beside Commit (with the merge message already
  prefilled), and it stays visible even when the status is otherwise clean;
  the toolbar state badge menu still works and both paths now clear the
  prefilled merge message.
- **Diffs open at the first change** — clicking a file in the working copy or
  a commit now scrolls the diff straight to its first changed lines instead
  of the top of the file, and `N` / `P` step to the next / previous change
  from the keyboard (joining `[` / `]` for previous / next file, all now
  listed in the Shortcuts reference).

### Changed
- **Conflict navigation moved to the Output divider** — a centered
  "Conflict n of m" pill with prev/next arrows floats between the panes and
  the Output, GitKraken-style, instead of living in the window header; the
  resolver also auto-jumps to the first conflict on open and the arrows show
  even for a single conflict.
- **Quieter unresolved markers** — unresolved conflicts in the Output show
  the conflict's own content dimmed behind a red stripe (base version when
  the file has diff3 markers, side A otherwise) instead of a wordy red
  banner; a section resolved as a deletion shows a "(section deleted)" row
  instead of disappearing.

### Fixed
- **AI conflict explanations were invisible** — the ✨ button's answer used to
  render below the entire file at the bottom of the A/B panes, so clicking
  appeared to do nothing. The explanation now opens in a floating panel over
  the panes, with an immediate "Explaining conflict…" state while the AI
  works and a dismiss button.
- **Conflict resolver Output pane now follows the work** — picking lines or
  editing a conflict auto-scrolls the Output pane to that conflict's result,
  and the prev/next navigation keeps both panes in sync.
- **Hand edits preserve CRLF line endings** — editing a conflict in a
  Windows-authored (CRLF) file no longer rewrites that block with LF-only
  lines.
- **Hand-edit safety** — Esc now reverts the editor's typing instead of
  silently keeping it (a stray keystroke can no longer mark a conflict
  resolved with both sides duplicated), an emptied edit now previews and
  saves consistently as a deleted section, cancelling a "replace hand edits?"
  dialog no longer half-applies the replacement, and files that legitimately
  contain `<<<<<<<` mid-line no longer block "Mark resolved".

## [0.6.0] — 2026-08-16

The identity release: work and personal finally live side by side — profiles
bind a commit identity and hosting accounts to each repository so the right
name and the right token are used automatically, expired tokens announce
themselves instead of breaking pushes silently, and the diff view learns to
walk files.

### Added
- **Profiles** — identity profiles grew into full work/personal profiles: each
  bundles a commit identity (name + email) with the hosting accounts to use
  per host. A repository is assigned to one profile — asked once on the first
  commit or push when more than one profile exists, silent when there is only
  one — and the assignment lives in that repo's local config, so it can never
  be forgotten or leak to other repositories. The toolbar shows the assigned
  profile next to the branch name; switch it any time from the repository menu
- **Multiple accounts per host** — connecting a second account for the same
  host (work + personal GitHub) no longer deletes the first. Accounts are
  identified by host and username, each token has its own keychain entry
  (existing entries migrate automatically), one account per host is marked
  default, and if the server rejects the chosen account the other account for
  that host is offered before giving up
- **Account health checks** — opening Settings → Authentication re-verifies
  each stored token against its provider. Expired or revoked tokens show a
  clear warning with a one-click Reconnect that prefills everything except the
  new token; GitHub and GitLab tokens with a known expiry date show
  "expires in N days" before they die
- **Previous/next file navigation in the diff view** — arrows and `[` / `]`
  step through the files of a commit or the working copy without going back
  to the file list, with an "n of m" position indicator
- **"Create pull request" in the status bar** — whenever the current branch is
  a feature branch on a recognized forge, a quiet button in the footer (and a
  command palette entry) opens the pre-filled pull/merge request page on
  GitHub, GitLab (including self-hosted), or Bitbucket — there when you want
  it, silent when you don't

### Fixed
- A failed push or fetch on a host with a connected account now says that the
  account's token may have expired and points at Settings → Authentication,
  instead of a generic "credentials refused" message — and the account is
  marked unverified so Settings reflects reality

## [0.5.0] — 2026-08-15

The safety-and-speed release: interactive rebase lands, terminals and history
gain lifetimes, secrets move to the keychain, and a deep audit fixed every
bug it found — from a conflict-corrupting parser to app-freezing edge cases.

### Added
- **Interactive rebase** — right-click a commit in the graph and choose
  "Interactively rebase onto here…" to reorder, reword, squash, fixup, or drop
  the commits above it. The rebase is all-or-nothing: if a step would
  conflict, nothing is changed and the message names the commit to reorder or
  drop. Undo restores the previous state with one click
- **Select commits and squash them directly** — ⌘-click or shift-click to
  select several commits in the graph, then right-click for "Squash N
  commits" or "Drop N commits"; the rebase plan opens pre-filled so you can
  adjust the combined message and confirm in one click
- **Terminal sessions persist per repository** — switching to another repo tab
  and back reattaches the same shell with its scrollback and any running
  command intact. A session ends only when its repo tab is closed, the shell
  exits, or the app quits
- **File history covers the file's whole lifetime** — it loads 500 changes at
  a time with a "Show older changes" button instead of stopping at the 200
  most recent
- **AI API keys are stored in the OS keychain** instead of plaintext local
  storage, matching how hosting tokens are kept. Existing keys migrate
  automatically on first launch and are scrubbed from the old storage

### Fixed
- The "rebase" badge no longer sticks forever after a conflicted rebase was
  resolved by hand — the state badge in the toolbar is now a menu offering
  continue, abort, or "clear state, keep everything as is" for rebase, merge,
  cherry-pick, revert, and bisect states (previously the app had no way to
  continue or conclude a paused rebase at all)
- The conflict resolver no longer corrupts files whose content contains lines of
  8 or more marker characters (`========` dividers, setext/RST underlines) —
  markers are now matched at exactly 7 characters, and unresolved conflicts
  round-trip byte-for-byte, preserving diff3 base labels, CRLF line endings, and
  bare markers
- Switching repositories while a slow refresh or history load was still in
  flight could flip the app back to the previous repository, show one repo's
  history under another's header, or apply an older filter's results over a
  newer one — every async store action now discards stale responses
- The built-in terminal no longer kills your running shell on every commit,
  fetch, or file change — the session now survives refreshes and is only
  recreated when you switch repositories
- Pasting large input into the terminal (or a paused pager) could freeze the
  entire app — terminal, file, and watcher commands now run off the main thread
- Builds running inside the repository (`pnpm install`, `cargo build`) no
  longer cause a continuous refresh storm — the file watcher now ignores
  gitignored paths; changes arriving during a refresh trigger one trailing
  re-run instead of being dropped
- Merge, cherry-pick, and revert now check your git identity before touching
  the repository, so a missing user.name can no longer strand a repo
  mid-operation
- Force-pushing with tags no longer force-pushes the tags themselves
- Staging a broken symlink now stages it instead of deleting it from the index
- AI commit prefixes keep `$` sequences in branch names literal
- Undoing to an unknown reset mode is now rejected instead of silently
  performing a mixed reset

### Changed
- Large-repo performance: deep history scrolling no longer re-parses every
  skipped commit; the sidebar, working-copy lists, commit graph rows, and
  inspector re-render only when their own data changes; the selected commit's
  diff is no longer re-fetched while scrolling the graph; image diffs are
  capped at 10 MB per side instead of loading unbounded payloads; clone
  progress and AI requests generate less overhead
- The working copy's file lists are virtualized — a checkout touching
  thousands of files stays instant — and the conflict resolver virtualizes
  files over 1,500 lines, so a conflicted lockfile opens and scrolls smoothly
- Undo and redo of branch operations now verify the branch still points where
  it did — redoing a branch deletion can no longer discard commits made on a
  recreated branch

## [0.4.0] — 2026-08-11

Merging is the theme of this release: it now behaves the way the graph leads
you to expect, and explains itself along the way — dressed in new signature
themes and kept fresh by background fetching.

### Added
- **Angkor Dusk and Angkor Dawn signature themes** — a warm laterite dark and a
  sandstone light, with a kbach-inspired colonnade pattern (Angkor's baluster
  window columns) etched at low opacity into the welcome and splash screens.
  The ornament never appears behind the graph, diffs, or code, is invisible in
  every other theme, and your accent colour still applies on top. **Angkor Dusk
  is the default for new installs**; existing users keep their chosen theme
- **Auto fetch** — the app fetches from your remote in the background (Settings
  → Git, default every minute, also on window focus), so teammates' commits
  appear on the graph by themselves. Failures are silent and back off
- **Repository tabs can be reordered by drag and drop**, and the order is
  remembered
- **A GitKraken-style conflict resolver.** Sides A and B sit in aligned panes
  with a checkbox on every line — take a whole side from the pane header, or
  cherry-pick individual lines. The Output pane below shows the clean merged
  result with no `<<<<<<<`/`>>>>>>>` markers: picked lines carry an A/B tag in
  their side's colour (in the order you picked them) and unresolved sections
  show a clear placeholder. Hand-editing moved behind an explicit pencil
  button, with the same guards as before
- **Commit details show a change-type summary** — "M 72 modified · A 57 added ·
  D 1 deleted" instead of a flat file count, and each file row's icon is tinted
  by its change type, matching the working copy's A/M/D/R colour convention
- **Ahead/behind badges cap at 99+** in the sidebar, toolbar, and status bar —
  a branch 1172 commits ahead no longer stretches its row; hover tooltips keep
  the exact count where one exists
- **The commit box pre-fills git's merge message** ("Merge branch 'x' into y")
  after a conflicted merge, so finishing the merge is one click once conflicts
  are resolved — it never overwrites a message you already typed
- **The drag-and-drop dialog explains each action** — merge (records a merge
  commit), fast-forward (moves the pointer), rebase (replays commits, rewrites
  history) — so the choice is clear without knowing git terminology

### Changed
- **"Already up to date" now shows as an info toast, not a green success** —
  everywhere an operation can report it (merge, pull, fast-forward)
- **Explicit branch merges now always create a merge commit** (like GitKraken).
  Previously, merging a branch whose changes were already contained in the
  source fast-forwarded — the branch pointer moved with no visible
  "Merge branch 'x' into y" commit on the graph, which read as "the merge did
  nothing". Drag-and-drop merge and the "Merge into current" context menus now
  record a real merge commit; the drop dialog offers a fast-forward option —
  shown only when the target is strictly behind, like GitKraken. Pull still
  fast-forwards when it can

### Fixed
- **The graph now updates when only remote refs change.** A fetch that moved
  `origin/…` without touching your checked-out branch used to refresh the file
  status only — new remote commits and behind-badges never appeared until a
  manual reload
- **Graph avatars on the first lane no longer have their coloured ring clipped**
  on the left edge of the graph column
- **Merge and rebase now always target the branch, never a same-named tag.** In
  repositories with a tag named like a branch (deployment tags such as `demo` or
  `production` are common), merging that branch silently resolved to the old
  tagged commit — the merge reported "Already up to date" or merged stale
  content. The graph's branch filter had the same flaw, so sidebar clicks could
  show a tag's old history instead of the branch's. Branch names now resolve to
  `refs/heads/…`, then `refs/remotes/…`, before anything else
- **Fast-forward merges no longer discard uncommitted changes.** The
  fast-forward path used a force checkout, silently wiping local edits; it now
  uses a safe checkout and refuses (with an error) if local changes would be
  overwritten, matching git's own behaviour
- **Drag-and-drop merge/rebase reads the current branch from the repository**,
  not from possibly stale UI state, before deciding whether to check out the
  target branch first

## [0.3.0] — 2026-08-10

Connecting to a remote is the theme of this release. Several controls looked
like they worked and did not; those are fixed or gone.

### Added
- **An SSH card in Settings → Authentication**: toggle the SSH agent, browse for
  a private key instead of typing a path, show and copy the matching public key
  (the thing you paste into GitHub/GitLab/Bitbucket), and generate a new ed25519
  key without leaving the app. Generation always picks a free filename, so an
  existing key can never be overwritten
- **A toggle for the system credential helper**: turn it off to stop AngKorGit
  falling back to credentials saved by git or another client, so a configured
  account can be tested on its own

### Changed
- **Settings → Accounts is now Settings → Authentication**, holding both hosting
  accounts and SSH keys. Which credential applies was the most confusing thing
  about connecting to a remote — the tab now states it plainly (`https://`
  remotes use accounts, `git@` remotes use SSH keys). The Git tab keeps committer
  identity and profiles

### Fixed
- **Bitbucket accounts now use API tokens**: Bitbucket Cloud removed app
  passwords on 2026-07-28, so the tab pointed at a dead page and asked for a
  credential that no longer exists. The link now opens the Atlassian API token
  page, the hint names the required `read:repository:bitbucket` +
  `write:repository:bitbucket` scopes, and the username field asks for the
  Atlassian account email
- **Connecting an account verifies the token instead of always claiming success**:
  every row showed a green tick whether or not anything had been checked, and
  Bitbucket and other hosts saved any typed string as valid. Tokens are verified
  against the provider before saving where the provider supports it, the tick
  appears only for verified accounts, and unverified ones are labelled as such.
  Bitbucket verification also detects the real Bitbucket username from the
  Atlassian email, so the stored username is the one git actually needs
- **The "SSH private key" setting now does something**: present since the first
  commit, its value was never sent to the git engine — only `~/.ssh/id_ed25519`
  and `~/.ssh/id_rsa` were ever tried, so anyone with a differently-named key
  entered a path, saw no error, and still could not authenticate. The configured
  key is now tried ahead of the defaults, `~` is expanded, and each retry advances
  to the next candidate instead of re-offering the first one forever
- **AI provider settings survive switching providers**: model, base URL and API
  key were one shared record, so trying another provider for an hour and
  switching back meant re-entering everything. Each provider keeps its own
  settings now, restored on switch and across restarts. This also stops one
  provider's API key being sent to another
- **"Reduce motion" now reduces motion**: the toggle was stored and never read.
  It now disables the app's movement animations (dialogs, fades, slides, the
  diff caret, Framer Motion) — scoped to exactly those, so enabling it costs
  nothing while scrolling — and it defaults to your OS reduce-motion preference
  on first run
- **Several SSH keys work without the agent**: only the configured key plus
  `~/.ssh/id_ed25519` and `~/.ssh/id_rsa` were ever offered, so a second key
  under any other name was never tried. The other keypairs in `~/.ssh` are now
  offered too, up to five in total (servers refuse after a handful of failed
  attempts). Note that AngKorGit does not read `~/.ssh/config` — `Host` and
  `IdentityFile` rules that work in your terminal do not apply here; use the
  SSH agent for per-host keys
- **OpenCode installed the recommended way is now detected**: the official
  installer puts the binary in `~/.opencode/bin` and adds PATH only to `.zshrc`,
  which neither the well-known-locations scan nor the login-shell fallback could
  see. That directory — plus pnpm's global bin and mise shims — is now scanned
  directly
- **Plan-limit and permission failures are explained**: HTTP 402 and 403 from a
  remote surfaced as raw libgit2 text (`unexpected http status code: 402;
  class=Http (34)`). They now carry a plain description and the error codes
  `plan_limit` / `forbidden`
- **Clone dialog describes authentication accurately**: it credited only the SSH
  agent and credential helper, never mentioning saved accounts — the first
  credential source the engine tries

### Removed
- **Settings that did nothing**: the "Git executable" field claimed to configure
  the built-in terminal but was read by no code (the terminal spawns your shell),
  and an unused `githubUser` value sat in stored settings. Both are gone, along
  with the Advanced card that held them and an unused `repo_discover` IPC command

## [0.2.0] — 2026-08-09

### Fixed
- **AI explanations no longer stick to the wrong commit**: selecting a
  different commit (or conflict file) clears the previous "Explain with AI"
  result instead of showing it under the new selection; an in-flight
  explanation can no longer land on a commit you've already navigated away from
- **AI explanation panels no longer clip long lines**: unbreakable tokens
  (long paths, URLs) in "Explain with AI" output and commit bodies now wrap
  instead of overflowing the inspector/conflict panels, and the assistant is
  instructed to answer in plain text (no raw markdown syntax on screen)
- **Commit message drafts no longer leak between repositories**: the draft (and
  the amend checkbox) was plain component state, so switching tabs/repos showed
  one project's unfinished message in another project's commit box. Drafts are
  now stored per repository path — each repo keeps its own draft, drafts survive
  app restarts, and committing clears only that repo's draft.

### Added
- **Customizable commit message style**: Settings → AI Assistant now has a
  "Commit message style" section — pick Conventional commits, Plain summary, or
  describe your own convention in plain words. Branch prefix rules
  (`staging → [support]`, `feature/* → [{suffix}]`, tokens `{branch}`,
  `{suffix}`, `{ticket}`; first match wins) are enforced by AngKorGit itself
  after generation, so the prefix always holds even if the model ignores it. A
  live preview shows what the current branch would produce. The style config is
  structured per capability so future AI features (e.g. code review) can carry
  their own conventions.
- **AI features without an API key — use the AI CLI you already have**: a new
  "Installed AI CLI" provider in Settings → AI Assistant detects Claude Code,
  Codex CLI, Gemini CLI, OpenCode and Antigravity CLI (`agy`, model overrides
  like `gemini-3.1-pro-high`) on your machine and runs them locally for
  commit messages, diff explanations, conflict help and reviews. Requests go
  through the CLI's own login and quota — AngKorGit stores no key and sends
  nothing anywhere itself. Each request is a one-shot prompt executed in a
  neutral directory (Codex runs sandboxed read-only), with a timeout and
  ANSI-clean output parsing; an optional model override passes through to the
  CLI. Detection survives Finder-launched sessions (GUI apps don't inherit the
  shell PATH) via well-known install locations plus a login-shell fallback.

## [0.1.3] — 2026-08-09

### Fixed
- **Filtered graph no longer explodes lanes**: searching commits or filtering
  by author renders a clean flat results list — one aligned avatar column with
  ref badges inline — instead of dots drifting endlessly to the right over the
  commit messages (parents outside the filter used to open a new lane per
  commit that was never freed)
- **Commit dots can no longer paint over message text**: the graph gutter
  clips its contents and pins the node inside the visible area even on very
  wide graphs
- **First-lane avatars were clipped on their left edge**: the lane origin now
  leaves room for the full avatar circle
- **Relative times no longer wrap to two lines**: the time column fits the
  widest value ("11mo ago") on a single line
- **Website**: docs pages now emit their own meta description and a correct
  per-page canonical URL (previously every page canonicalized to the
  homepage); footer "Contributing" link no longer 404s; docs titles are
  sentence-cased

### Changed
- **Large diffs scroll smoothly** (huge SQL/data files): word-level diff
  degrades gracefully on very long line pairs instead of building an O(m×n)
  token table, syntax highlighting skips extremely long lines and caches
  per-line results, fewer offscreen rows are rendered, and diffs over 3000
  lines stay on the virtualized no-wrap path (the wrap toggle disables itself
  with an explanatory hint)
- **Website install section** reads the latest release version from GitHub at
  build time and the site redeploys automatically when a release is published
  — no more hardcoded version drifting stale

### Added
- **Marketing website** (`apps/website`, Astro 5): hero, features, screenshot
  gallery, performance, AI, install, and open-source sections with dark/light
  themes — deployed to GitHub Pages at `https://angkorgit.app/` (custom domain,
  root base path) with SEO meta, Open Graph, sitemap, and JSON-LD
  `SoftwareApplication` structured data
- **Docs on the website**: repo `docs/*.md` now render on-site at
  `https://angkorgit.app/docs/` (sidebar navigation, breadcrumbs, sitemap) —
  no more tab-switching to GitHub; the GitHub repo stays for source/releases
- **One-line terminal installs** on the website: copy-button quick-install
  commands per OS (dmg with `xattr -cr`, NSIS exe, AppImage)
- **Getting Started guide** (`docs/Getting-Started.md`): first-launch steps
  per platform, now linked from the website install section

### Fixed
- **OG image clipped at the right edge**: headline reduced to fit the 1200px
  canvas, and the `og:image` URL is cache-busted (`?v=3`) so messaging apps
  (Telegram/Slack) refetch the corrected preview

## [0.1.2] — 2026-08-05

### Added
- **Find in diff**: ⌘F over any diff (center panel and file history) — live
  match count, Enter/⇧Enter navigation with wraparound, case toggle,
  pixel-perfect highlights measured from the rendered text, and the view
  scrolls **both vertically and horizontally** to each match
- **12 popular editor themes**: VS Code Dark+/Light+, GitHub Dark/Light,
  One Dark Pro, Tokyo Night, Catppuccin Mocha/Latte, Dracula, Nord,
  Ayu Dark/Light — full surface + syntax palettes, picked from a swatch grid
  in Settings; the accent color works on every theme
- **Folder tree everywhere**: a persisted List/Tree toggle for the working
  copy *and* commit file lists — collapsible folders with counts, deep
  single-child chains compressed into one row
- **Stash previews**: click a stash in the sidebar to see its message,
  author, and full file diffs before applying
- **Commit graph keyboard navigation**: ↑/↓ walk commits, Home/End jump to
  newest/oldest, selection auto-scrolls
- **Copy from diffs**: right-click offers Copy (selected text) and Copy line
  in every diff — commit and file-history diffs included
- **Diffs feel like a read-only editor**: click a pane to place a blinking
  caret, then ⌘A selects just that side (old or new) and ⌘C copies its full
  text — every line, correctly formatted, straight from the diff data.
  "Select all" also sits in the right-click menu
- **The living graph**: author avatars are the commit nodes (merges stay
  dots), and a BRANCH/TAG rail docks one pill per branch beside the graph —
  laptop/cloud icons for local/origin presence, ✓ on the checked-out branch,
  lane-colored connectors, hover to expand long names. Double-click a pill
  to checkout; right-click for checkout/merge/rebase/pull/push/copy

### Changed
- Working copy reordered: **Changes on top, Staged at the bottom** next to
  the commit box — staging moves files toward the commit
- Duplicate diff-view toggles removed from the inspector header

## [0.1.1] — 2026-08-04

### Added
- **Repository tabs**: a GitKraken-style strip above the toolbar — one tab per
  open project, click to switch, ✕/middle-click to close, ＋ to open another;
  tabs persist across restarts
- **Submodules, first-class**: right-click a submodule → **Open as repository**
  (full graph, history — double-click works too), **Update** (init + checkout
  the recorded commit, now authenticated through the full credential chain so
  private hosts work), Copy path
- **Remote management**: right-click a remote → Fetch, **Edit remote…**
  (rename + URL), **Remove remote…** (confirmed; the server is untouched)
- **Status bar**: current branch, commits to push/pull, working-copy state,
  a zoom picker (50–200%), and the app version doubling as a
  check-for-updates button
- **Minimap scrubbing**: drag the diff overview rail to scroll, like a
  scrollbar thumb

### Fixed
- Opening file history while a diff preview was open showed nothing until the
  diff was closed — it now takes over the center area
- Sidebar remote entries no longer wrap the raw URL (name + tooltip instead)
- Zoom honors exact levels (50–200%) instead of clamping to 60–160% and
  rounding to the nearest 10%

## [0.1.0] — 2026-08-04

The first release. 🏛️

### Repository & history
- Open, clone (with progress), init, and search recent repositories; instant repo switcher
- Virtualized commit graph (100k-commit repositories stay smooth) with search,
  author and branch filters, ref/tag/HEAD decorations, and merge topology
- **WIP row** pinned above the graph whenever the working tree has changes
- Live filesystem watcher — external edits and terminal commits appear within ~½s

### Committing & review
- Stage/unstage files, **individual hunks, and individual lines** (right-click
  a line in any diff view mode); discard file/line/all with verified outcomes
  (submodule-aware explanations, pair-aware line restore)
- Auto-growing commit box with 50/72 summary counter; hidden when the tree is clean
- Full-width diff view with **minimap**, previous/next-change navigation,
  inline & side-by-side, word-level diff, whole-file mode, image diffs —
  virtualized for any file size, editor-grade smooth scrolling and panning
- **File history**: ⌘K → "File history…" (or right-click a file) — docked
  commit list showing who changed the file and when, one-click diff switching,
  side panels auto-collapse for a full-width review
- **Built-in file editor**: right-click → Edit file, ⌘S saves in place

### Branching & operations
- Branch **folder tree** with right-click context menu: checkout, merge, rebase,
  **pull/push per branch** (fast-forward without checkout), create branch here,
  rename, delete
- **Drag a branch onto another** to merge or rebase
- Cherry-pick, revert (conflict-safe, merge-aware), reset (soft/mixed/hard)
- **Undo/redo (⌘Z/⌘⇧Z)** for commits, checkouts, merges, rebases, cherry-picks,
  resets, reverts and branch operations — with repo-moved and dirty-tree guards

### Conflicts
- Visual resolver: checkbox per side (keep both!), conflict-to-conflict
  navigation, and a fully **editable result pane** with marker guards

### Accounts & identity
- Multi-provider **hosting accounts** (GitHub, GitLab.com, self-hosted GitLab,
  Bitbucket) — tokens in the OS keychain, matched to remotes by host
- **Identity profiles** (work/personal) applied per-repository — immune to other
  tools rewriting the global gitconfig

### Experience
- ⌘K command palette, built-in PTY terminal, resizable panels, collapsible sidebar
- Dark/light themes + **5 accent colors**; UI zoom (⌘±); Gravatar author avatars
- Product-grade Settings window (navigation rail, titled sections)
- AI assistant with pluggable providers (OpenAI, Anthropic, Gemini, Ollama,
  LM Studio): commit messages, diff/conflict explanations, PR descriptions, reviews

[Unreleased]: https://github.com/cheat2001/angkorgit/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/cheat2001/angkorgit/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/cheat2001/angkorgit/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/cheat2001/angkorgit/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/cheat2001/angkorgit/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/cheat2001/angkorgit/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/cheat2001/angkorgit/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/cheat2001/angkorgit/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/cheat2001/angkorgit/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/cheat2001/angkorgit/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/cheat2001/angkorgit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/cheat2001/angkorgit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/cheat2001/angkorgit/compare/v0.6.6...v0.7.0
[0.6.6]: https://github.com/cheat2001/angkorgit/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/cheat2001/angkorgit/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/cheat2001/angkorgit/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/cheat2001/angkorgit/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/cheat2001/angkorgit/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/cheat2001/angkorgit/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/cheat2001/angkorgit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cheat2001/angkorgit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cheat2001/angkorgit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cheat2001/angkorgit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cheat2001/angkorgit/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/cheat2001/angkorgit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/cheat2001/angkorgit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cheat2001/angkorgit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cheat2001/angkorgit/releases/tag/v0.1.0
