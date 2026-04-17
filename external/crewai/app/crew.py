"""
CrewAI agent/crew implementation.

Uses Claude via the Anthropic API (requires ANTHROPIC_API_KEY).
Agent personas are loaded from agents.json at the project root.
"""

import json
import os
import time
from pathlib import Path

from crewai import LLM, Agent, Crew, Process, Task

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "agents.json"
DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_OUTPUT_TOKENS = 2048

# Conversation history keyed by chain_id for multi-round support
# Each entry maps chain_id -> list of {"role": "user"|"assistant", "content": str}
_conversation_histories: dict[str, list[dict[str, str]]] = {}


def _get_model() -> str:
    return os.environ.get("MODEL", DEFAULT_MODEL)


def _get_max_output_tokens() -> int:
    return int(os.environ.get("AGENT_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS))


def _build_llm() -> LLM:
    return LLM(
        model=f"anthropic/{_get_model()}",
        max_tokens=_get_max_output_tokens(),
    )


def _load_personas() -> list[dict]:
    """Load all agent personas from agents.json."""
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    return config["agents"]


def run_single_agent(agent_name: str, system_prompt: str, message: str, chain_id: str | None = None) -> dict:
    """Run a single-agent CrewAI crew and return the result."""
    model = _get_model()
    llm = _build_llm()

    # Build task description with conversation history for multi-round support
    history_key = f"{chain_id}:{agent_name}" if chain_id else None
    history = _conversation_histories.get(history_key, []) if history_key else []

    task_description = message
    if history:
        context_lines = []
        for entry in history:
            role = "User" if entry["role"] == "user" else agent_name
            context_lines.append(f"[{role}]: {entry['content']}")
        task_description = (
            "Previous conversation:\n"
            + "\n\n".join(context_lines)
            + f"\n\nNew message:\n{message}"
        )

    agent = Agent(
        role=agent_name,
        goal="Respond to user queries accurately and helpfully",
        backstory=system_prompt,
        llm=llm,
        verbose=False,
    )
    task = Task(
        description=task_description,
        expected_output="A helpful, relevant response",
        agent=agent,
    )
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
    )

    start = time.perf_counter()
    result = crew.kickoff()
    duration_ms = (time.perf_counter() - start) * 1000

    usage = None
    if result.token_usage:
        # Report total processed input (fresh + cached) to keep protocol
        # comparisons apples-to-apples regardless of caching.
        prompt = result.token_usage.prompt_tokens or 0
        cached = getattr(result.token_usage, "cached_prompt_tokens", 0) or 0
        usage = {
            "input_tokens": prompt + cached,
            "output_tokens": result.token_usage.completion_tokens or 0,
        }

    # Store conversation history for multi-round support
    if history_key:
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": result.raw})
        _conversation_histories[history_key] = history

    return {
        "response_text": result.raw,
        "usage": usage,
        "model": model,
        "duration_ms": round(duration_ms, 1),
    }


def run_full_crew(message: str, chain_id: str | None = None) -> list[dict]:
    """Run the full multi-agent crew and return per-agent results."""
    model = _get_model()
    llm = _build_llm()
    personas = _load_personas()

    # Build task descriptions with conversation history for multi-round support
    history = _conversation_histories.get(chain_id, []) if chain_id else []
    context_prefix = ""
    if history:
        context_lines = []
        for entry in history:
            context_lines.append(f"[{entry['role']}]: {entry['content']}")
        context_prefix = "Previous conversation:\n" + "\n\n".join(context_lines) + "\n\nNew message:\n"

    agents = []
    tasks = []

    for persona in personas:
        agent = Agent(
            role=persona["name"],
            goal=f"Respond from the perspective of {persona['name']} using skills: {', '.join(persona['skills'])}",
            backstory=persona["systemPrompt"],
            llm=llm,
            verbose=False,
        )
        agents.append(agent)

        task = Task(
            description=f"{context_prefix}{message}",
            expected_output=f"A response from {persona['name']} addressing the user's query",
            agent=agent,
        )
        tasks.append(task)

    crew = Crew(
        agents=agents,
        tasks=tasks,
        process=Process.sequential,
        verbose=False,
    )

    start = time.perf_counter()
    result = crew.kickoff()
    total_duration_ms = (time.perf_counter() - start) * 1000

    results = []
    n = len(personas)
    all_responses = []
    for i, task_output in enumerate(result.tasks_output):
        per_task_usage = None
        if result.token_usage:
            # Report total processed input (fresh + cached), divided evenly
            # across agents since CrewAI aggregates at the crew level.
            total_prompt = result.token_usage.prompt_tokens or 0
            total_cached = getattr(result.token_usage, "cached_prompt_tokens", 0) or 0
            total_input = total_prompt + total_cached
            total_completion = result.token_usage.completion_tokens or 0
            per_task_usage = {
                "input_tokens": total_input // n,
                "output_tokens": total_completion // n,
            }

        all_responses.append(f"[{personas[i]['name']}]: {task_output.raw}")
        results.append({
            "agent_name": personas[i]["name"],
            "response_text": task_output.raw,
            "usage": per_task_usage,
            "model": model,
            "duration_ms": round(total_duration_ms / n, 1),
        })

    # Store conversation history for multi-round support
    if chain_id:
        history.append({"role": "user", "content": message})
        history.append({"role": "agents", "content": "\n\n".join(all_responses)})
        _conversation_histories[chain_id] = history

    return results
