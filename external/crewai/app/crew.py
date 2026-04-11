"""
CrewAI agent/crew implementation.

Uses Claude via the Anthropic API (requires ANTHROPIC_API_KEY).
Agent personas are loaded from agents.json at the project root.
"""

import json
import os
import time
from pathlib import Path

from crewai import Agent, Crew, Process, Task

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "agents.json"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"


def _get_model() -> str:
    return os.environ.get("MODEL", DEFAULT_MODEL)


def _load_personas() -> list[dict]:
    """Load all agent personas from agents.json."""
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    return config["agents"]


def run_single_agent(agent_name: str, system_prompt: str, message: str) -> dict:
    """Run a single-agent CrewAI crew and return the result."""
    model = _get_model()

    agent = Agent(
        role=agent_name,
        goal="Respond to user queries accurately and helpfully",
        backstory=system_prompt,
        llm=f"anthropic/{model}",
        verbose=False,
    )
    task = Task(
        description=message,
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
        usage = {
            "input_tokens": result.token_usage.prompt_tokens or 0,
            "output_tokens": result.token_usage.completion_tokens or 0,
        }

    return {
        "response_text": result.raw,
        "usage": usage,
        "model": model,
        "duration_ms": round(duration_ms, 1),
    }


def run_full_crew(message: str) -> list[dict]:
    """Run the full multi-agent crew and return per-agent results."""
    model = _get_model()
    personas = _load_personas()

    agents = []
    tasks = []

    for persona in personas:
        agent = Agent(
            role=persona["name"],
            goal=f"Respond from the perspective of {persona['name']} using skills: {', '.join(persona['skills'])}",
            backstory=persona["systemPrompt"],
            llm=f"anthropic/{model}",
            verbose=False,
        )
        agents.append(agent)

        task = Task(
            description=message,
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
    for i, task_output in enumerate(result.tasks_output):
        per_task_usage = None
        if result.token_usage:
            total_prompt = result.token_usage.prompt_tokens or 0
            total_completion = result.token_usage.completion_tokens or 0
            per_task_usage = {
                "input_tokens": total_prompt // n,
                "output_tokens": total_completion // n,
            }

        results.append({
            "agent_name": personas[i]["name"],
            "response_text": task_output.raw,
            "usage": per_task_usage,
            "model": model,
            "duration_ms": round(total_duration_ms / n, 1),
        })

    return results
