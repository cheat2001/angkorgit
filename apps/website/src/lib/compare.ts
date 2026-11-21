export interface Competitor {
  slug: string;
  name: string;
  short: string;
  title: string;
  description: string;
  kicker: string;
  heading: string;
  intro: string[];
  facts: { label: string; theirs: string; ours: string }[];
  theyDo: string[];
  weDo: string[];
  faq: { q: string; a: string }[];
}

const OURS = {
  platforms: 'macOS, Windows and Linux',
  price: 'Free, no tiers',
  source: 'Open source, MIT',
  engine: 'Rust and libgit2 in one process, the webview your OS already ships',
  signIn: 'None. Open a folder and start',
};

export const COMPETITORS: Competitor[] = [
  {
    slug: 'gitkraken',
    name: 'GitKraken Desktop',
    short: 'GitKraken',
    title: 'GitKraken alternative: AngKorGit, a free and open source Git client',
    description:
      'Looking for a free GitKraken alternative? AngKorGit is an open source Git client for macOS, Windows and Linux with the commit graph, drag-to-merge and conflict editor, without the sign-in or the paid plan for private repositories.',
    kicker: 'AngKorGit vs GitKraken',
    heading: 'A GitKraken alternative that <em>isn’t a browser</em>.',
    intro: [
      'GitKraken is the client I learned the most from. The graph, dragging one branch onto another, undo for the scary operations, all of that is in AngKorGit because GitKraken showed it was the right way to work.',
      'What I didn’t want was the rest of it. A sign-in before the first commit, a plan that decides whether my private repositories count, and a whole browser shipped inside the app. AngKorGit has no account and no plan. Private or public, it’s the same repository.',
    ],
    facts: [
      { label: 'Platforms', theirs: 'macOS, Windows and Linux', ours: OURS.platforms },
      {
        label: 'Price',
        theirs: 'Free for local repositories and public remotes. Private remotes need a paid seat',
        ours: OURS.price,
      },
      { label: 'Source code', theirs: 'Closed', ours: OURS.source },
      { label: 'Built with', theirs: 'Electron, a bundled copy of Chromium', ours: OURS.engine },
      { label: 'Sign-in', theirs: 'A GitKraken account', ours: OURS.signIn },
    ],
    theyDo: [
      'Pull request review inside the app, with comments and approvals',
      'Issue tracker integrations such as Jira and GitHub Issues',
      'Cloud workspaces and other team features',
      'Git LFS from the interface',
    ],
    weDo: [
      'Worktrees as first class: list them, open each one as a tab, create one from any branch',
      'AI that uses the CLI you already pay for (Claude Code, Codex, Gemini CLI, Copilot) or any API key. Commit messages, explanations, reviews',
      'A conflict editor where the result pane is a real editor with line numbers on both sides',
      'Identity profiles stored per repository, so switching profiles never rewrites your global gitconfig',
      'Commit signing through your existing git config, SSH or GPG, with nothing to set up in the app',
    ],
    faq: [
      {
        q: 'Do I need to migrate anything?',
        a: 'No. A repository is a folder with a .git directory. Open it in AngKorGit and it’s all there. Your remotes, branches and stashes are plain git, nothing is stored in a proprietary format.',
      },
      {
        q: 'Does it work with GitHub, GitLab and Bitbucket?',
        a: 'Yes. Connect an account with a token and the sidebar lists open pull requests, you can check one out, and you can create one with reviewers without leaving the app. Reviewing itself stays in the browser on purpose, the forge does that better.',
      },
      {
        q: 'Is there a paid tier coming?',
        a: 'No. The whole thing is MIT licensed and on GitHub. If it saves you time there is a GitHub Sponsors link in the footer, and that is the extent of the business model.',
      },
    ],
  },
  {
    slug: 'sourcetree',
    name: 'Sourcetree',
    short: 'Sourcetree',
    title: 'Sourcetree alternative for Linux, macOS and Windows: AngKorGit',
    description:
      'A free Sourcetree alternative that runs on Linux as well as macOS and Windows. AngKorGit is an open source Git client with a fast commit graph, hunk and line staging, and a visual conflict resolver, with no Atlassian sign-in.',
    kicker: 'AngKorGit vs Sourcetree',
    heading: 'The Sourcetree alternative that <em>runs on Linux</em>.',
    intro: [
      'Sourcetree is free and it has been around for a long time, so a lot of people started there. It runs on macOS and Windows. If you moved to Linux, or you work across all three, it simply isn’t an option.',
      'The other two things I hear about it are the Atlassian sign-in on first launch and how it feels on a large repository. AngKorGit has no sign-in at all, and the graph and diffs are virtualized, so a long history scrolls like a short one.',
    ],
    facts: [
      { label: 'Platforms', theirs: 'macOS and Windows', ours: OURS.platforms },
      { label: 'Price', theirs: 'Free', ours: OURS.price },
      { label: 'Source code', theirs: 'Closed, made by Atlassian', ours: OURS.source },
      { label: 'Built with', theirs: 'Native toolkit on each platform', ours: OURS.engine },
      { label: 'Sign-in', theirs: 'An Atlassian account on first launch', ours: OURS.signIn },
    ],
    theyDo: [
      'Git-flow buttons for starting and finishing features and releases',
      'Git LFS setup from the interface',
      'Deep Bitbucket and Jira integration, it is an Atlassian product',
      'Many years in use, so most edge cases have been hit by someone',
    ],
    weDo: [
      'Linux, with AppImage, .deb and .rpm builds',
      'Worktrees in the sidebar, each opening as its own tab',
      'Interactive rebase with reorder, squash, reword and drop, and undo if you get it wrong',
      'A conflict resolver with both sides aligned, line numbers, and a result pane you can type in',
      'Pull requests for GitHub, GitLab and Bitbucket in one client, not only Bitbucket',
    ],
    faq: [
      {
        q: 'Can I keep using Bitbucket?',
        a: 'Yes. Add a Bitbucket account with an API token under Settings, Authentication, and the pull request list, checkout and create all work. Bitbucket Server is supported for git operations, the pull request list is Bitbucket Cloud only for now.',
      },
      {
        q: 'Does it do git-flow?',
        a: 'Not as buttons. Branch, merge and tag are all there, and drag one branch onto another merges it, but there is no git-flow wizard. If you rely on that daily, Sourcetree still does it and AngKorGit does not.',
      },
      {
        q: 'What about my existing repositories and SSH keys?',
        a: 'Nothing changes. Repositories are plain git folders, and SSH keys are the ones in ~/.ssh. AngKorGit talks to the agent, so a passphrase-protected key keeps working the way it does in your terminal.',
      },
    ],
  },
  {
    slug: 'fork',
    name: 'Fork',
    short: 'Fork',
    title: 'Fork alternative: AngKorGit, a free and open source Git client that also runs on Linux',
    description:
      'Fork is a fast, paid Git client for macOS and Windows. AngKorGit is free, open source, and runs on Linux too, with a virtualized commit graph, worktrees, interactive rebase and a visual conflict editor.',
    kicker: 'AngKorGit vs Fork',
    heading: 'Like Fork, but <em>free</em>, open, and on Linux.',
    intro: [
      'Fork is the client I’d point most people to if they use a Mac or Windows and are happy to pay once. It’s fast, it’s native, and it’s been polished for years. I don’t have a bad word for it.',
      'AngKorGit is for the cases Fork doesn’t cover. You’re on Linux. You want to read the source of the thing that touches your repositories. You’d rather not pay, or you want worktrees, an AI hook, or a conflict editor that shows both sides with line numbers. It’s also younger, and I say so on this page rather than pretend otherwise.',
    ],
    facts: [
      { label: 'Platforms', theirs: 'macOS and Windows', ours: OURS.platforms },
      { label: 'Price', theirs: '$59.99 once, with a free evaluation', ours: OURS.price },
      { label: 'Source code', theirs: 'Closed', ours: OURS.source },
      { label: 'Built with', theirs: 'Native toolkit on each platform', ours: OURS.engine },
      { label: 'Sign-in', theirs: 'None', ours: OURS.signIn },
    ],
    theyDo: [
      'A longer track record and a lot of small polish that only years bring',
      'A repository manager for many repositories at once',
      'Git LFS from the interface',
      'Native widgets on both platforms, which some people prefer to a webview',
    ],
    weDo: [
      'Linux builds alongside macOS and Windows',
      'Worktrees as a first class sidebar section, each one a tab',
      'AI for commit messages, explanations and reviews, through the CLI you already have or any API key',
      'A conflict editor with both sides aligned, line numbers on each, and a result pane you edit in place',
      'The whole source under MIT, so you can read what runs against your repositories',
    ],
    faq: [
      {
        q: 'Is AngKorGit as fast as Fork?',
        a: 'On opening a repository and scrolling a long history, yes, both are quick. Fork has had more years to smooth out the corners, and I would rather you find that out on this page than after installing.',
      },
      {
        q: 'Can I run both?',
        a: 'Yes. Neither one changes the repository format, and AngKorGit writes its own settings only to repository-local config keys prefixed angkorgit. Open the same folder in both and nothing fights.',
      },
      {
        q: 'Why a webview instead of native widgets?',
        a: 'It gives me one interface on three platforms and the OS already ships the webview, so there is nothing to bundle. The engine underneath is Rust and libgit2 in the same process, which is where the speed comes from.',
      },
    ],
  },
  {
    slug: 'tower',
    name: 'Tower',
    short: 'Tower',
    title: 'Tower alternative: AngKorGit, a free Git client for macOS, Windows and Linux',
    description:
      'Tower is a paid Git client for macOS and Windows with a yearly subscription. AngKorGit is a free, open source alternative with a commit graph, drag-to-merge, worktrees, a visual conflict resolver and no subscription.',
    kicker: 'AngKorGit vs Tower',
    heading: 'The Tower alternative with <em>no subscription</em>.',
    intro: [
      'Tower is a serious client with a lot of care in it, and a yearly price to match. It runs on macOS and Windows. For a team that already pays for it, it’s a fine choice and I won’t argue.',
      'AngKorGit is for the person who doesn’t want a renewal, wants the source in the open, or needs the same client on a Linux machine. The graph, drag and drop between branches, undo, interactive rebase and the conflict editor are all here, without the invoice.',
    ],
    facts: [
      { label: 'Platforms', theirs: 'macOS and Windows', ours: OURS.platforms },
      { label: 'Price', theirs: 'From $69 a year, 30 day trial. Free for students and teachers', ours: OURS.price },
      { label: 'Source code', theirs: 'Closed', ours: OURS.source },
      { label: 'Built with', theirs: 'Native toolkit on each platform', ours: OURS.engine },
      { label: 'Sign-in', theirs: 'A Tower account for the licence', ours: OURS.signIn },
    ],
    theyDo: [
      'Undo for nearly every operation, refined over many years',
      'Drag and drop in more places than I have built so far',
      'Git LFS and services integration from the interface',
      'Native widgets on both platforms',
    ],
    weDo: [
      'Linux builds alongside macOS and Windows',
      'Free, with the source on GitHub under MIT',
      'Worktrees in the sidebar, each one a tab',
      'AI for commit messages, explanations and reviews using the tools you already have',
      'Identity profiles stored per repository, never in your global gitconfig',
    ],
    faq: [
      {
        q: 'Does AngKorGit have undo?',
        a: 'Yes, for commits, checkouts, merges, rebases, resets, reverts, cherry-picks and branch operations. It records the state before and after and refuses to undo if the repository has moved on in a way that would lose work.',
      },
      {
        q: 'Does it handle a large repository?',
        a: 'The graph and the diffs are virtualized, so a history of a hundred thousand commits scrolls like fifty. Reading the repository happens through libgit2 in the same process, there is no daemon to wait for.',
      },
      {
        q: 'Is there a trial?',
        a: 'There is nothing to trial. Download it, use it, and delete it if it isn’t for you. No licence key, no account.',
      },
    ],
  },
  {
    slug: 'github-desktop',
    name: 'GitHub Desktop',
    short: 'GitHub Desktop',
    title: 'GitHub Desktop alternative with a commit graph: AngKorGit',
    description:
      'GitHub Desktop is free and simple but has no commit graph, no interactive rebase and no official Linux build. AngKorGit is a free, open source Git client with all three, and it works with GitHub, GitLab and Bitbucket alike.',
    kicker: 'AngKorGit vs GitHub Desktop',
    heading: 'GitHub Desktop, but with <em>a graph</em>.',
    intro: [
      'GitHub Desktop is where a lot of people learn Git, and it does the simple flow well. It’s also free and open source, which I respect. The moment you need to see how branches relate, rebase interactively, or work against GitLab, it runs out of road.',
      'AngKorGit keeps the friendly parts, the confirmations before anything destructive, undo, plain wording, and adds the graph, the branch operations and the conflict editor that GitHub Desktop leaves out. It’s also the same app on Linux, not a community build.',
    ],
    facts: [
      { label: 'Platforms', theirs: 'macOS and Windows. Linux through a community build', ours: OURS.platforms },
      { label: 'Price', theirs: 'Free', ours: OURS.price },
      { label: 'Source code', theirs: 'Open source, MIT', ours: OURS.source },
      { label: 'Built with', theirs: 'Electron, a bundled copy of Chromium', ours: OURS.engine },
      { label: 'Sign-in', theirs: 'A GitHub account for anything beyond local repositories', ours: OURS.signIn },
    ],
    theyDo: [
      'The tightest GitHub integration: notifications, checks, Codespaces',
      'A very gentle learning curve for a first repository',
      'Backing from GitHub, so it will be maintained for a long time',
    ],
    weDo: [
      'A commit graph, virtualized, with drag one branch onto another to merge or rebase',
      'Interactive rebase, cherry-pick, worktrees, stashes with per-file restore',
      'GitHub, GitLab and Bitbucket pull requests in one client',
      'A conflict resolver instead of a hand-off to your editor',
      'An official Linux build, with AppImage, .deb and .rpm',
    ],
    faq: [
      {
        q: 'Is it harder to use than GitHub Desktop?',
        a: 'There is more on screen, because there is more it can do. The everyday flow is the same: change files, tick them, write a message, commit, push. Destructive actions ask first and can be undone.',
      },
      {
        q: 'Will my GitHub account work?',
        a: 'Yes. Add it under Settings, Authentication with a token, classic or fine-grained. Pull requests then show in the sidebar, and pushes use the token from your system keychain.',
      },
      {
        q: 'Do I need GitHub at all?',
        a: 'No. AngKorGit works with any git remote over HTTPS or SSH, and with no remote at all.',
      },
    ],
  },
];

export function competitor(slug: string): Competitor {
  const found = COMPETITORS.find((c) => c.slug === slug);
  if (!found) throw new Error(`unknown competitor ${slug}`);
  return found;
}
