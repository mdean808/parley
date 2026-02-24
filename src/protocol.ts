import { storeMessage } from "./store.ts";
import { encodeMessage } from "./toon.ts";
import type { ProtocolAgent } from "./agent.ts";

export async function broadcastRequest(
  userId: string,
  message: string,
  agents: ProtocolAgent[]
): Promise<void> {
  const chainId = crypto.randomUUID();

  const request = storeMessage({
    chainId,
    replyTo: undefined,
    type: "REQUEST",
    payload: message,
    from: userId,
    to: "*",
  });

  console.log(`\n--- REQUEST ---`);
  console.log(encodeMessage(request));
  console.log(`---------------\n`);

  await Promise.all(
    agents.map((agent) => agent.handleRequest(request))
  );
}
