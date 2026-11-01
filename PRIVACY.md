# Decision Keeper: Privacy Policy

_Last updated: 1 November 2026_

Decision Keeper is an Atlassian Forge app that helps teams record and retrieve their decisions in Jira,
Confluence and Rovo. This policy explains what data the app handles.

## Where data is stored

Decision Keeper **runs on Atlassian** (Forge). All data stays inside Atlassian's infrastructure:

- The decision registry (title, rationale, author name, source issue or page, tags, dates, and the
  Atlassian account ID of the person who recorded the decision) is stored in **Forge Key-Value Storage**,
  scoped to the site where the app is installed.
- If a site admin connects the Teamwork Graph connector, decisions are also published to that site's
  **Atlassian Teamwork Graph**, visible to users of the workspace.

The app has **no external servers** and makes **no requests outside Atlassian** (no egress).
The developer does not receive, store or sell any customer data.

## What data is read

- **Jira issues and comments** and **Confluence pages**, only when a user asks the app to look for
  decisions. These requests run **as the current user**, so the app only sees content that user can
  already access. Content is read on demand and is not copied, except for decisions a user explicitly
  chooses to save.

## Logs

Forge platform logs may contain technical error messages. Site admins control whether logs are shared
with the developer in Atlassian Administration.

## Deleting data

Uninstalling the app deletes its Forge storage according to Atlassian's data retention rules.
Disconnecting the Teamwork Graph connector stops further publishing to the graph.

## Contact

Questions: open an issue at https://github.com/zak01E/decision-keeper/issues
