import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { contractAck, contractComment, contractRead, contractSubmit } from "../../runtime/module-store.mjs";

// The role identity is injected by the launcher.  These tools deliberately do
// not expose arbitrary peer messaging: every negotiation mutation is stored in
// the debate trace and therefore participates in the 30-action limit.
export default function (pi: ExtensionAPI) {
  const moduleId = process.env.PI_TEAM_MODULE_ID;
  const role = process.env.PI_TEAM_ROLE;
  const root = process.env.PI_TEAM_PROJECT_ROOT || process.cwd();
  const identity = () => {
    if (!moduleId || !role) throw new Error("module contract identity is not injected");
    return { role };
  };
  pi.registerTool({ name: "contract_read", label: "Contract Read", description: "Read the current module contract or a stable field path. Reads do not count as negotiation.", parameters: Type.Object({ field: Type.Optional(Type.String({ maxLength: 400 })) }), async execute(_id, input) { return { content: [{ type: "text", text: JSON.stringify(await contractRead(root, moduleId!, input.field)) }] }; } });
  pi.registerTool({ name: "contract_submit", label: "Contract Submit", description: "Executor only: submit one grouped set of body field changes plus an explanation. This clears ACKs and counts as one negotiation action.", parameters: Type.Object({ fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())), body: Type.Optional(Type.Record(Type.String(), Type.Unknown())), explanation: Type.String({ maxLength: 2000 }) }), async execute(_id, input) { return { content: [{ type: "text", text: JSON.stringify(await contractSubmit(root, moduleId!, identity(), input)) }] }; } });
  pi.registerTool({ name: "contract_comment", label: "Contract Comment", description: "Executor or Validator: submit field-specific feedback or a reply. It counts as one negotiation action.", parameters: Type.Object({ field: Type.Optional(Type.String({ maxLength: 400 })), fields: Type.Optional(Type.Array(Type.String({ maxLength: 400 }))), comment: Type.String({ maxLength: 4000 }), reply_to: Type.Optional(Type.String({ maxLength: 240 })) }), async execute(_id, input) { return { content: [{ type: "text", text: JSON.stringify(await contractComment(root, moduleId!, identity(), input)) }] }; } });
  pi.registerTool({ name: "contract_ack", label: "Contract ACK", description: "Confirm the complete contract body you read. The server rejects stale bodies; both Executor and Validator ACKs freeze it.", parameters: Type.Object({ complete_body: Type.Record(Type.String(), Type.Unknown()) }), async execute(_id, input) { return { content: [{ type: "text", text: JSON.stringify(await contractAck(root, moduleId!, identity(), input.complete_body)) }] }; } });
}
