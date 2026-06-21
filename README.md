# amendor-mcp

Connect your coding agent to [Amendor](https://amendor.site).

Amendor lets the people you build for request changes right on your live site. Requests land on a board. This connector pulls them into your agent (Claude Code, Cursor, Cline, Codex, any MCP client) so it can build each one on a branch and open a pull request.

## Setup

1. Sign in at [amendor.site](https://amendor.site) and create a project.
2. Copy your connector command from Settings:

   ```
   claude mcp add amendor --env RELAY_API=https://amendor.site --env RELAY_TOKEN=your-token -- npx -y amendor-mcp
   ```

3. Run it in your repo.

`RELAY_TOKEN` comes from your account, so create a project first.

## Use it

Ask your agent: "show me the change requests," pick one, "build that one." It opens a pull request, your host builds a preview, the requester approves, you merge.

Tools: `list_change_requests`, `get_change_request`, `start_build`, `set_preview_url`, `publish_preview`, `update_status`, `ship_change`.

MIT license. More at [amendor.site](https://amendor.site).
