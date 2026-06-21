# amendor-mcp

Connect your coding agent to [Amendor](https://amendor.site).

Amendor lets the people you build for request changes right on your live site. Requests land on a board. This connector pulls them into your agent (Claude Code, Cursor, Cline, Codex, any MCP client) so it can build each one on a branch and open a pull request.

## Setup

1. Sign in at [amendor.site](https://amendor.site) and create a project.
2. Go to Settings and copy the connector command. It already has your token filled in and looks like this:

   ```
   claude mcp add amendor --env AMENDOR_API=https://amendor.site --env AMENDOR_TOKEN=your-token -- npx -y amendor-mcp
   ```

3. Run it in your repo.

`AMENDOR_TOKEN` is the key that ties the connector to your Amendor account. You do not make it up. Amendor generates it and shows it inside the ready-made command on the Settings page, so create a project first, then copy the whole command.

## Use it

Ask your agent: "show me the change requests," pick one, "build that one." It opens a pull request, your host builds a preview, the requester approves, you merge.

Tools: `list_change_requests`, `get_change_request`, `start_build`, `set_preview_url`, `publish_preview`, `update_status`, `ship_change`.

MIT license. More at [amendor.site](https://amendor.site).
