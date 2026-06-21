#!/usr/bin/env node
/* Relay MCP server — the handoff seam.
   Add to Claude Code so you can pull accepted change requests straight into a session:
   "list my change requests" → pick one → Claude reads the exact element + screenshot → builds it. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = process.env.RELAY_API || 'http://localhost:4000';
const TOKEN = process.env.RELAY_TOKEN; // connector token from /settings

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(API + path, { ...opts, headers });
  if (r.status === 401) throw new Error('Not authorized. Create a project at amendor.site/settings and copy your connector command (it includes RELAY_TOKEN).');
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const server = new McpServer({ name: 'amendor', version: '0.1.1' });

server.tool(
  'list_change_requests',
  'List change requests submitted by end users on sites you ship. Optionally filter by status: new, accepted, preview, approved, shipped, rejected. Start here to see what people are asking for.',
  { status: z.string().optional() },
  async ({ status }) => {
    const tasks = await api('/api/tasks' + (status ? `?status=${status}` : ''));
    const text = tasks.length
      ? tasks
          .map((t) => `• [${t.id}] (${t.status}) "${t.request_text}"\n    page: ${t.page_url}`)
          .join('\n')
      : 'No change requests found.';
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'get_change_request',
  'Get full detail for one change request so you can implement it: the user request, the exact element they pointed at (CSS selector + outerHTML), the page URL, and a screenshot URL. Call this before making the change.',
  { id: z.string() },
  async ({ id }) => {
    const t = await api('/api/tasks/' + id);
    const els = t.elements && t.elements.length
      ? t.elements
      : t.selector
        ? [{ selector: t.selector, html: t.element_html }]
        : [];
    const elBlock = els.length
      ? els.map((e, i) => `  [${i + 1}] selector: ${e.selector}\n      html: ${e.html || '(n/a)'}`).join('\n')
      : '  (none — general request, not tied to a specific element)';
    const text = [
      `CHANGE REQUEST ${t.id}  (status: ${t.status})`,
      `Page:         ${t.page_url}`,
      `Requested by: ${t.requester_email || 'anonymous'}`,
      ``,
      `WHAT THEY WANT:`,
      `  ${t.request_text}`,
      ...(t.verdict === 'down' && t.verdict_comment
        ? ['',
           `⟳ REVISION REQUESTED — the requester reviewed a preview and wants changes:`,
           `   "${t.verdict_comment}"`,
           `   Push to the SAME branch/PR (relay/task-${t.id}); don't open a new one.`]
        : []),
      ``,
      `ATTACHED ELEMENTS (${els.length}):`,
      elBlock,
      ``,
      t.screenshot_url ? `Screenshot: ${API}${t.screenshot_url}` : `Screenshot: (none)`,
      (t.attachment_urls && t.attachment_urls.length)
        ? `Attachments (${t.attachment_urls.length}):\n` + t.attachment_urls.map((u) => `  ${API}${u}`).join('\n')
        : `Attachments: (none)`,
      ``,
      `When done: open a PR with "relay-task:${t.id}" in the branch name or PR body,`,
      `then call set_preview_url with the deploy-preview link.`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'set_preview_url',
  'Attach a deploy-preview URL to a change request and mark it ready for the requester to review.',
  { id: z.string(), url: z.string() },
  async ({ id, url }) => {
    await api('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preview_url: url, status: 'preview' }),
    });
    return { content: [{ type: 'text', text: `Preview attached. Requester reviews at ${API}/t/${id}` }] };
  }
);

server.tool(
  'update_status',
  'Update a change request status: accepted, building, preview, approved, shipped, rejected.',
  { id: z.string(), status: z.string() },
  async ({ id, status }) => {
    await api('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return { content: [{ type: 'text', text: `Status → ${status}` }] };
  }
);

server.tool(
  'start_build',
  'LOCAL MODE ONLY (repo on this machine, no host). Cuts a branch + git worktree the local Relay serves at /preview/<id>/. For the normal GitHub flow, do NOT call this: instead branch "relay/task-<id>" in your own repo clone, edit, commit, push, and open a PR tagged "relay-task:<id>" — the host builds the preview and the webhook captures it automatically.',
  { id: z.string() },
  async ({ id }) => {
    const r = await api('/api/tasks/' + id + '/build', { method: 'POST' });
    const text = [
      `Build started for ${id}.`,
      `Branch:   ${r.branch} (off ${r.base})`,
      `EDIT HERE: ${r.worktree}`,
      `Preview:  ${API}${r.preview_url}  (serves the worktree live)`,
      ``,
      `Make the change in that folder, run "git add -A && git commit" there,`,
      `then call publish_preview to send the requester the link.`,
    ].join('\n');
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'publish_preview',
  'Mark a change request ready for the requester to review. The preview is already live from the worktree; this flips status to "in preview" and surfaces the link.',
  { id: z.string() },
  async ({ id }) => {
    await api('/api/tasks/' + id + '/publish', { method: 'POST' });
    return { content: [{ type: 'text', text: `Published. Requester reviews at ${API}/t/${id}` }] };
  }
);

server.tool(
  'ship_change',
  'Ship an approved change: merge the task branch into the project base, remove the worktree, and mark it shipped. Production (the live site) now reflects the change.',
  { id: z.string() },
  async ({ id }) => {
    const r = await api('/api/tasks/' + id + '/ship', { method: 'POST' });
    return { content: [{ type: 'text', text: `Shipped. Merged ${r.merged} into ${r.into}.` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[relay-mcp] connected, talking to ${API}`);
