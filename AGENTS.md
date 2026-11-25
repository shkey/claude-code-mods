# Claude Code mods

Each plugin lives under `plugins/<name>/` with its own manifest, README and tests. The root `.claude-plugin/marketplace.json` is the catalog. Keep entry names equal to manifest names. Bump the changed plugin's manifest version for releases; do not set a second version in the catalog.

Validate the root and changed plugin with `claude plugin validate`. Run `claude plugin test` inside the changed plugin. For type checks, load it with an interactive engine to generate declarations, then run `bun x --bun -p typescript@5 tsc -p .` from the plugin folder. Do not track engine-generated type files or `tsconfig.json`. Use synthetic fixtures. Do not commit personal settings, session data, credentials, or local Git history.
