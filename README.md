# Decision Keeper

**The memory of your team's decisions, built on Atlassian Forge.**

Teams make decisions in meetings, Jira comments and Confluence pages — then forget them.
The same debates come back, and new work quietly contradicts what was already agreed.

Decision Keeper captures decisions where they happen, explains *why* they were made,
and warns you before you go against them.

Built for [Codegeist 2026](https://codegeist2026.devpost.com/).

## Features

### Rovo agent: Decision Keeper
Ask in Rovo chat:
- *"Why did we choose PostgreSQL?"* — searches the registry, Jira comments and Confluence pages, and cites its sources.
- *"Save it in the registry."* — records the decision with its rationale, author, source and tags (`DEC-1`, `DEC-2`, …).
- *"I'm planning to migrate to MongoDB. Does this contradict anything?"* — compares your plan with active decisions and warns you, quoting the decision, its date and its rationale.
- *"We changed our mind…"* — records a new decision that supersedes the old one.

### Jira issue panel: Decisions
On every issue:
- **Check before you change course** — active decisions from elsewhere that share keywords with this issue.
- **Decisions found in comments** — comments that read like decisions ("we decided…", "agreed…"), with a one-click *Save as decision*.
- **Decisions made on this issue** — what is already recorded for this issue.

### MCP server: decisions in any AI assistant
The same four tools are exposed through Forge's `rovo:mcp` module, so Claude, Cursor, VS Code or any
MCP-compatible client can ask about — and record — team decisions without leaving the editor.

| Tool | What it does |
|---|---|
| `list-decisions` | Active decisions, optionally filtered by keyword |
| `record-decision` | Saves a decision (title, rationale, author, source, tags, supersedes) |
| `find-jira-decisions` | Decision-like Jira comments about a topic |
| `find-confluence-decisions` | Confluence pages recording decisions about a topic |

Endpoint: `https://mcp.atlassian.com/forge/ad3473e0-41c7-4594-9098-e12fa4ca4d2c`

A site admin first enables the tools in **Atlassian Administration → Connected apps → Decision Keeper →
Expose tools to MCP-compatible apps**. Each user then signs in through Atlassian's OAuth consent screen,
and every call runs with that user's own permissions.

## How it works

| Part | File |
|---|---|
| Decision registry (Forge Key-Value Storage) | `src/decisions.js` |
| Rovo agent actions | `src/index.js` |
| Issue panel resolver | `src/resolvers/index.js` |
| Issue panel UI (UI Kit) | `src/frontend/index.jsx` |
| Modules, actions, scopes | `manifest.yml` |

Jira and Confluence are always queried **as the current user** (`asUser()`), so people only ever
see decisions from content they are allowed to access. Scopes are kept minimal:
`storage:app`, `read:jira-work`, `search:confluence`.

## Run it yourself

Requirements: Node.js 22, the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) and an Atlassian Cloud site.

```bash
npm install
forge register        # registers a copy of the app under your account
forge deploy -e development
forge install --product jira --site <your-site>.atlassian.net
forge install --product confluence --site <your-site>.atlassian.net
```

Then open Rovo chat, pick the **Decision Keeper** agent, or open any Jira issue and add the **Decisions** panel.

## License

MIT
