import Anthropic from "@anthropic-ai/sdk";
import type { Agent, Message } from "./types.ts";
import { storeMessage } from "./store.ts";
import { encodeMessage } from "./toon.ts";

const MODEL = "claude-sonnet-4-5-20250929";
const client = new Anthropic();

export class ProtocolAgent {
  agent: Agent;
  systemPrompt: string;

  constructor(agent: Agent, systemPrompt: string) {
    this.agent = agent;
    this.systemPrompt = systemPrompt;
  }

  async handleRequest(request: Message): Promise<Message> {
    // ACK
    const ack = storeMessage({
      chainId: request.chainId,
      replyTo: request.id,
      type: "ACK",
      payload: `${this.agent.name} acknowledged request`,
      from: this.agent.id,
      to: request.from,
    });
    console.log(`  [${this.agent.name}] ACK`);

    // PROCESS
    const process = storeMessage({
      chainId: request.chainId,
      replyTo: request.id,
      type: "PROCESS",
      payload: `${this.agent.name} is processing request`,
      from: this.agent.id,
      to: request.from,
    });
    console.log(`  [${this.agent.name}] PROCESS`);

    // LLM call
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: this.systemPrompt,
      messages: [{ role: "user", content: request.payload }],
    });

    const responseText =
      completion.content[0].type === "text" ? completion.content[0].text : "";

    // RESPONSE
    const response = storeMessage({
      chainId: request.chainId,
      replyTo: request.id,
      type: "RESPONSE",
      payload: responseText,
      from: this.agent.id,
      to: request.from,
    });

    console.log(`\n  [${this.agent.name}] RESPONSE:`);
    console.log(`  ${responseText}\n`);
    console.log(`  TOON:\n${encodeMessage(response)}\n`);

    return response;
  }
}
