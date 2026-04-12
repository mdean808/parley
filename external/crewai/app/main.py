import time

from fastapi import FastAPI, HTTPException

from .crew import run_full_crew, run_single_agent
from .models import (
    CrewRunRequest,
    CrewRunResponse,
    HealthResponse,
    SingleRunRequest,
    SingleRunResponse,
)

import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "agents.json"


def _load_agent_names() -> list[str]:
    with open(_CONFIG_PATH) as f:
        config = json.load(f)
    return [a["name"] for a in config["agents"]]


AGENTS = _load_agent_names()

app = FastAPI(title="CrewAI Benchmark Wrapper")


@app.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(status="ok", agents=AGENTS)


@app.post("/run-single")
async def handle_run_single(req: SingleRunRequest) -> SingleRunResponse:
    start = time.perf_counter()
    try:
        result = run_single_agent(req.agent_name, req.system_prompt, req.message, req.chain_id)
    except NotImplementedError as e:
        return SingleRunResponse(
            agent_name=req.agent_name,
            response_text="",
            error=str(e),
        )
    except Exception as e:
        return SingleRunResponse(
            agent_name=req.agent_name,
            response_text="",
            error=f"CrewAI error: {e}",
        )
    elapsed_ms = (time.perf_counter() - start) * 1000

    return SingleRunResponse(
        agent_name=req.agent_name,
        response_text=result.get("response_text", ""),
        usage=result.get("usage"),
        model=result.get("model"),
        duration_ms=result.get("duration_ms", elapsed_ms),
    )


@app.post("/run-crew")
async def handle_run_crew(req: CrewRunRequest) -> CrewRunResponse:
    start = time.perf_counter()
    try:
        agent_results = run_full_crew(req.message, req.chain_id)
    except NotImplementedError as e:
        return CrewRunResponse(
            results=[],
            total_duration_ms=0,
            error=str(e),
        )
    except Exception as e:
        return CrewRunResponse(
            results=[],
            total_duration_ms=0,
            error=f"CrewAI error: {e}",
        )
    elapsed_ms = (time.perf_counter() - start) * 1000

    results = [
        SingleRunResponse(
            agent_name=r.get("agent_name", "unknown"),
            response_text=r.get("response_text", ""),
            usage=r.get("usage"),
            model=r.get("model"),
            duration_ms=r.get("duration_ms"),
        )
        for r in agent_results
    ]

    return CrewRunResponse(
        results=results,
        total_duration_ms=elapsed_ms,
    )
