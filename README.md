# SharkNyx Free

SharkNyx Free integrates supported AI chat pages with Roblox Studio through a local browser extension and bridge. **SharkNyx v1.5.7** is distributed as the Full ZIP, which contains the local Portal (v1.3.1), companion extension (v1.2.7), and bridge files.

## Install

1. Download and extract `SharkNyx-v1.5.7-Full.zip` from the GitHub Release.
2. Load the `sharknyx-extension` folder as an unpacked extension from `chrome://extensions` or `edge://extensions`.
3. Start `Portal/start-portal.bat` on Windows or `Portal/start-portal.command` on macOS/Linux, then open `http://127.0.0.1:3000/` in the same browser profile.
4. Open and sign in to your provider on its ordinary website. A Portal send requires an already-open provider tab and visibly switches to it; there are no custom login popups or automatically created background tabs.
5. Start the local bridge with `start.bat` (Windows) or `MacOS_Start.command` (macOS). Roblox Agent mode also requires a live Studio MCP connection.

DeepSeek remains a **manual-only** Portal handoff; the extension does not automate or read that site. The Portal uses no provider API keys, and does not read or transfer passwords, cookies, or session tokens. The hosted Portal deployment is not changed by this local GitHub release.

See [`CHANGELOG.md`](CHANGELOG.md) and the Portal's `README.md`/`PORTAL_BRIDGE.md` for details and limitations.
