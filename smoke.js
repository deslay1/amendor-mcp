// Quick MCP handshake test: spawns index.js, lists tools, calls one against live data.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['index.js'],
  env: { ...process.env, RELAY_API: 'http://localhost:4000' },
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const res = await client.callTool({ name: 'list_change_requests', arguments: {} });
console.log('--- list_change_requests ---');
console.log(res.content[0].text);

// pull the newest id from the live API and show the full brief the agent receives
const newest = (await (await fetch('http://localhost:4000/api/tasks')).json())[0];
const detail = await client.callTool({ name: 'get_change_request', arguments: { id: newest.id } });
console.log('\n--- get_change_request (' + newest.id + ') ---');
console.log(detail.content[0].text);

await client.close();
process.exit(0);
