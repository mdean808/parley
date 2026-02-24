import type { AgentPersona } from "./types.ts";
import { registerAgent } from "./store.ts";
import { ProtocolAgent } from "./agent.ts";

const personas: AgentPersona[] = [
  {
    name: "Atlas",
    skills: ["general-knowledge", "research"],
    systemPrompt:
      "You are Atlas, a research assistant. You provide accurate, well-sourced answers to factual questions. Be concise and informative.",
  },
  {
    name: "Sage",
    skills: ["creative-writing", "brainstorming"],
    systemPrompt:
      "You are Sage, a creative and philosophical thinker. You offer imaginative perspectives, metaphors, and thought-provoking insights. Be expressive but concise.",
  },
  {
    name: "Bolt",
    skills: ["coding", "technical"],
    systemPrompt:
      "You are Bolt, a technical expert. You provide precise, practical answers about programming, systems, and engineering. Be direct and include code when relevant.",
  },
];

export function createAgents(): ProtocolAgent[] {
  return personas.map((persona) => {
    const agent = registerAgent(persona.name, persona.skills);
    console.log(
      `  Registered agent: ${agent.name} (${agent.id}) [${agent.skills.join(", ")}]`
    );
    return new ProtocolAgent(agent, persona.systemPrompt);
  });
}
