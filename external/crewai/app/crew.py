"""
CrewAI agent/crew implementation.

Implement the two functions below to wire up your CrewAI agents.
See README.md for detailed instructions.
"""


def run_single_agent(agent_name: str, system_prompt: str, message: str) -> dict:
    """Run a single-agent CrewAI crew and return the result.

    Should return a dict with:
        - response_text: str
        - usage: {"input_tokens": int, "output_tokens": int} | None
        - model: str | None
        - duration_ms: float | None

    Example:
        from crewai import Agent, Task, Crew, Process

        agent = Agent(
            role=agent_name,
            goal="Respond to user queries",
            backstory=system_prompt,
            llm="claude-sonnet-4-5-20250929",
        )
        task = Task(
            description=message,
            expected_output="A helpful response",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], process=Process.sequential)
        result = crew.kickoff()

        return {
            "response_text": result.raw,
            "usage": {
                "input_tokens": result.token_usage.prompt_tokens,
                "output_tokens": result.token_usage.completion_tokens,
            } if result.token_usage else None,
            "model": "claude-sonnet-4-5-20250929",
            "duration_ms": None,
        }
    """
    raise NotImplementedError(
        f"Implement run_single_agent() for '{agent_name}'. See README.md."
    )


def run_full_crew(message: str) -> list[dict]:
    """Run the full 3-agent crew and return per-agent results.

    Should return a list of dicts, each with the same shape as run_single_agent().

    The three agents should match the benchmark personas:
        - "Atlas - Research" (skills: general-knowledge, research)
        - "Sage - Creative" (skills: creative-writing, brainstorming)
        - "Bolt - Technical" (skills: coding, technical)

    Example:
        from crewai import Agent, Task, Crew, Process

        atlas = Agent(role="Atlas - Research", ...)
        sage = Agent(role="Sage - Creative", ...)
        bolt = Agent(role="Bolt - Technical", ...)

        research_task = Task(description=message, agent=atlas, ...)
        creative_task = Task(description=message, agent=sage, ...)
        technical_task = Task(description=message, agent=bolt, ...)

        crew = Crew(
            agents=[atlas, sage, bolt],
            tasks=[research_task, creative_task, technical_task],
            process=Process.sequential,  # or Process.hierarchical
        )
        result = crew.kickoff()

        return [
            {"agent_name": t.agent.role, "response_text": t.raw, ...}
            for t in result.tasks_output
        ]
    """
    raise NotImplementedError("Implement run_full_crew(). See README.md.")
