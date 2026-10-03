# Atlas MCP server

The MCP server gives an agent the same Atlas that a person reads in the Portal.
It can find a starting explanation, read its context and cited material, and
prepare a draft for review. Its Atlas root, source grants and private storage are
fixed when the server starts.

Connect through the Editor's **Connect an agent** panel, or print configuration
with `atlas --root /absolute/atlas config`. Install that configuration in the
agent host, then ask it to read the operating guide and inspect the Atlas, including
its complete adopted Style through `atlas_inspect {"style":true}`. See
[working with agents](../../docs/working-with-agents.md).

A useful reading task names the question and asks the agent to distinguish the
account from its evidence. `atlas_route` discovery returns compact candidates;
an exact Point or Tree-local Facet selector opens the full explanation, and `next` requests
continue omitted detail. Facets retain their interpretation and source reads
remain explicit. Direct citations and source review help the agent identify
accounts that may need another look. Source inspection remains read-only;
`atlas_record_source_review` explicitly retains a session observation or exact-byte
disposition, while `atlas_source_history` reads that private history. Inventories
and draft inspections default to bounded summaries. Exact reads, full output and
`part: "details"` chunks preserve access to the complete material.

For changes, `atlas_absorb_prepare` records what each contribution does and why.
Saving keeps that reasoning and unresolved questions with the draft. The agent
can inspect consequences, review candidate Checks and retain their evidence
before the user authorizes application. Applying requires the exact saved
revision and checks that its baseline and selected source bytes still match.

The [MCP reference](../../docs/reference/mcp.md) defines tools, session freshness,
candidate review and transport limits. The server uses stdin/stdout; stdout is
reserved for protocol messages.
