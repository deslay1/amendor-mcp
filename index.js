#!/usr/bin/env node
/* Amendor MCP server — the handoff seam.
   Add to Claude Code (or any MCP client) so you can pull change requests straight
   into a session: "list my change requests" -> pick one -> the agent reads the exact
   element + screenshot -> builds it on a branch and opens a PR. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = process.env.AMENDOR_API || process.env.RELAY_API || 'http://localhost:4000';
const TOKEN = process.env.AMENDOR_TOKEN || process.env.RELAY_TOKEN; // connector token from amendor.site/settings

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(API + path, { ...opts, headers });
  if (r.status === 401) throw new Error('Not authorized. Create a project at amendor.site/settings and copy your connector command (it includes AMENDOR_TOKEN).');
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const STATUS = 'new, accepted, building, preview, approved, shipped, or rejected';

const server = new McpServer({ name: 'amendor', version: '0.1.3' });

server.registerTool(
  'list_change_requests',
  {
    title: 'List change requests',
    description: 'List change requests submitted by end users on sites you ship. Optionally filter by status. Start here to see what people are asking for.',
    inputSchema: {
      status: z.string().optional().describe(`Optional status filter: ${STATUS}. Omit to list every open request.`),
    },
    outputSchema: {
      requests: z.array(z.object({
        id: z.string().describe('Change request id; pass to get_change_request.'),
        status: z.string().describe('Current status of the request.'),
        request_text: z.string().describe('What the user asked for, in their own words.'),
        page_url: z.string().describe('URL of the page the request was made on.'),
      })).describe('Matching change requests, newest first.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  },
  async ({ status }) => {
    const tasks = await api('/api/tasks' + (status ? `?status=${encodeURIComponent(status)}` : ''));
    const requests = tasks.map((t) => ({ id: t.id, status: t.status, request_text: t.request_text, page_url: t.page_url || '' }));
    const text = requests.length
      ? requests.map((t) => `• [${t.id}] (${t.status}) "${t.request_text}"\n    page: ${t.page_url}`).join('\n')
      : 'No change requests found.';
    return { content: [{ type: 'text', text }], structuredContent: { requests } };
  }
);

server.registerTool(
  'get_change_request',
  {
    title: 'Get change request',
    description: 'Get full detail for one change request so you can implement it: the user request, the exact element they pointed at (CSS selector + outerHTML), the page URL, and a screenshot URL. Call this before making the change.',
    inputSchema: {
      id: z.string().describe('Change request id, from list_change_requests.'),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      status: z.string().describe('Current status.'),
      page_url: z.string().describe('URL of the page the request was made on.'),
      requested_by: z.string().describe('Requester email, or "anonymous".'),
      request_text: z.string().describe('What the user wants.'),
      revision_requested: z.boolean().describe('True if the requester reviewed a preview and asked for changes; push to the same branch/PR.'),
      revision_comment: z.string().describe('The revision note, or empty string if none.'),
      elements: z.array(z.object({
        selector: z.string().describe('CSS selector of the element the user pointed at.'),
        html: z.string().describe('outerHTML of that element; may be empty.'),
      })).describe('Elements attached to the request; empty for a general request.'),
      screenshot_url: z.string().describe('Absolute screenshot URL, or empty string.'),
      attachment_urls: z.array(z.string()).describe('Absolute URLs of any extra attachments.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  },
  async ({ id }) => {
    const t = await api('/api/tasks/' + id);
    const els = (t.elements && t.elements.length)
      ? t.elements.map((e) => ({ selector: e.selector || '', html: e.html || '' }))
      : (t.selector ? [{ selector: t.selector, html: t.element_html || '' }] : []);
    const revision = (t.verdict === 'down' && t.verdict_comment) ? t.verdict_comment : '';
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
      ...(revision
        ? ['',
           `⟳ REVISION REQUESTED — the requester reviewed a preview and wants changes:`,
           `   "${revision}"`,
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
    const structuredContent = {
      id: t.id,
      status: t.status,
      page_url: t.page_url || '',
      requested_by: t.requester_email || 'anonymous',
      request_text: t.request_text || '',
      revision_requested: !!revision,
      revision_comment: revision,
      elements: els,
      screenshot_url: t.screenshot_url ? `${API}${t.screenshot_url}` : '',
      attachment_urls: (t.attachment_urls || []).map((u) => `${API}${u}`),
    };
    return { content: [{ type: 'text', text }], structuredContent };
  }
);

server.registerTool(
  'set_preview_url',
  {
    title: 'Attach preview URL',
    description: 'Attach a deploy-preview URL to a change request and mark it ready for the requester to review.',
    inputSchema: {
      id: z.string().describe('Change request id.'),
      url: z.string().describe('Deploy-preview URL (from your host) that the requester will review.'),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      status: z.string().describe('New status, set to "preview".'),
      review_url: z.string().describe('Page where the requester reviews and approves the change.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  },
  async ({ id, url }) => {
    await api('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preview_url: url, status: 'preview' }),
    });
    const review_url = `${API}/t/${id}`;
    return { content: [{ type: 'text', text: `Preview attached. Requester reviews at ${review_url}` }], structuredContent: { id, status: 'preview', review_url } };
  }
);

server.registerTool(
  'update_status',
  {
    title: 'Update status',
    description: 'Update a change request status as it moves through the build and review flow.',
    inputSchema: {
      id: z.string().describe('Change request id.'),
      status: z.string().describe(`New status: ${STATUS}.`),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      status: z.string().describe('The status now set on the request.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  },
  async ({ id, status }) => {
    await api('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return { content: [{ type: 'text', text: `Status → ${status}` }], structuredContent: { id, status } };
  }
);

server.registerTool(
  'start_build',
  {
    title: 'Start local build',
    description: 'LOCAL MODE ONLY (repo on this machine, no host). Cuts a branch + git worktree the local Amendor serves at /preview/<id>/. For the normal GitHub flow, do NOT call this: instead branch "relay/task-<id>" in your own repo clone, edit, commit, push, and open a PR tagged "relay-task:<id>" — the host builds the preview and the webhook captures it automatically.',
    inputSchema: {
      id: z.string().describe('Change request id to start a local build for.'),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      branch: z.string().describe('Branch that was created.'),
      base: z.string().describe('Base branch it was cut from.'),
      worktree: z.string().describe('Local folder to edit; commit your change here.'),
      preview_url: z.string().describe('URL that serves the worktree live for review.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true, destructiveHint: false },
  },
  async ({ id }) => {
    const r = await api('/api/tasks/' + id + '/build', { method: 'POST' });
    const preview_url = `${API}${r.preview_url}`;
    const text = [
      `Build started for ${id}.`,
      `Branch:   ${r.branch} (off ${r.base})`,
      `EDIT HERE: ${r.worktree}`,
      `Preview:  ${preview_url}  (serves the worktree live)`,
      ``,
      `Make the change in that folder, run "git add -A && git commit" there,`,
      `then call publish_preview to send the requester the link.`,
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { id, branch: r.branch, base: r.base, worktree: r.worktree, preview_url } };
  }
);

server.registerTool(
  'publish_preview',
  {
    title: 'Publish preview',
    description: 'Mark a change request ready for the requester to review. The preview is already live from the worktree; this flips status to "in preview" and surfaces the link.',
    inputSchema: {
      id: z.string().describe('Change request id whose local preview is ready.'),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      status: z.string().describe('New status, set to "preview".'),
      review_url: z.string().describe('Page where the requester reviews and approves the change.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true, destructiveHint: false },
  },
  async ({ id }) => {
    await api('/api/tasks/' + id + '/publish', { method: 'POST' });
    const review_url = `${API}/t/${id}`;
    return { content: [{ type: 'text', text: `Published. Requester reviews at ${review_url}` }], structuredContent: { id, status: 'preview', review_url } };
  }
);

server.registerTool(
  'ship_change',
  {
    title: 'Ship change',
    description: 'Ship an approved change: merge the task branch into the project base, remove the worktree, and mark it shipped. Production (the live site) now reflects the change.',
    inputSchema: {
      id: z.string().describe('Change request id to ship (should be approved first).'),
    },
    outputSchema: {
      id: z.string().describe('Change request id.'),
      merged: z.string().describe('Branch that was merged.'),
      into: z.string().describe('Base branch it was merged into.'),
      status: z.string().describe('New status, set to "shipped".'),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true, destructiveHint: true },
  },
  async ({ id }) => {
    const r = await api('/api/tasks/' + id + '/ship', { method: 'POST' });
    return { content: [{ type: 'text', text: `Shipped. Merged ${r.merged} into ${r.into}.` }], structuredContent: { id, merged: r.merged, into: r.into, status: 'shipped' } };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[amendor-mcp] connected, talking to ${API}`);
