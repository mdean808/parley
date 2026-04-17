"""
A2A-compliant agent server.

Run 3 instances of this server, one per persona:

    python -m uvicorn agent_server.main:app --port 8001  # Atlas
    python -m uvicorn agent_server.main:app --port 8002  # Sage
    python -m uvicorn agent_server.main:app --port 8003  # Bolt

Configure the agent via environment variables:
    AGENT_NAME               - e.g. "Atlas - Research"
    AGENT_SKILLS             - comma-separated, e.g. "general-knowledge,research"
    AGENT_PORT               - port number (used in agent card URL)
    MODEL                    - Claude model (default: claude-sonnet-4-6, same as TS protocols)
    AGENT_MAX_OUTPUT_TOKENS  - per-completion output cap (default: 2048, same as TS protocols)
"""

import json
import os
import time
import uuid
from pathlib import Path

import anthropic
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

AGENT_NAME = os.environ.get("AGENT_NAME", "Atlas - Research")
AGENT_SKILLS = os.environ.get("AGENT_SKILLS", "general-knowledge,research").split(",")
AGENT_PORT = os.environ.get("AGENT_PORT", "8001")
MODEL = os.environ.get("MODEL", "claude-sonnet-4-6")
MAX_OUTPUT_TOKENS = int(os.environ.get("AGENT_MAX_OUTPUT_TOKENS", "2048"))

# Load system prompt from shared config
CONFIG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "agents.json"


def _load_system_prompt(agent_name: str) -> str:
    try:
        with open(CONFIG_PATH) as f:
            config = json.load(f)
        for agent in config["agents"]:
            if agent["name"] == agent_name:
                return agent["systemPrompt"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        pass
    return f"You are {agent_name}. Respond helpfully."


SYSTEM_PROMPT = _load_system_prompt(AGENT_NAME)

llm_client = anthropic.AsyncAnthropic()

# Conversation history keyed by contextId for multi-round support
conversation_histories: dict[str, list[dict]] = {}

app = FastAPI(title=f"A2A Agent: {AGENT_NAME}")


def get_agent_card() -> dict:
    return {
        "name": AGENT_NAME,
        "description": f"A2A benchmark agent: {AGENT_NAME}",
        "url": f"http://localhost:{AGENT_PORT}",
        "version": "0.1.0",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
        },
        "skills": [
            {"id": s.strip(), "name": s.strip()} for s in AGENT_SKILLS
        ],
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
    }


@app.get("/.well-known/agent-card.json")
async def agent_card():
    return get_agent_card()


@app.post("/")
async def handle_jsonrpc(request: Request):
    """Handle A2A JSON-RPC requests."""
    body = await request.json()

    method = body.get("method")
    params = body.get("params", {})
    request_id = body.get("id")

    if method == "message/send":
        return await handle_send_message(params, request_id)

    return JSONResponse(
        content={
            "jsonrpc": "2.0",
            "error": {"code": -32601, "message": f"Method not found: {method}"},
            "id": request_id,
        },
        status_code=200,
    )


async def handle_send_message(params: dict, request_id) -> JSONResponse:
    """Handle message/send — call Claude and return the response with token metadata."""
    message = params.get("message", {})
    parts = message.get("parts", [])
    user_text = " ".join(p.get("text", "") for p in parts if p.get("kind") == "text")
    context_id = message.get("contextId", str(uuid.uuid4()))
    task_id = message.get("taskId", str(uuid.uuid4()))

    # Build conversation history for multi-round support
    history = conversation_histories.get(context_id, [])
    history.append({"role": "user", "content": user_text})

    usage = None
    start_time = time.perf_counter()

    try:
        completion = await llm_client.messages.create(
            model=MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=SYSTEM_PROMPT,
            messages=history,
        )
        duration_ms = (time.perf_counter() - start_time) * 1000

        response_text = "".join(
            block.text for block in completion.content if block.type == "text"
        )
        # Report total processed input (fresh + cache reads + cache creation)
        # to keep protocol comparisons apples-to-apples regardless of caching.
        input_total = (
            completion.usage.input_tokens
            + (getattr(completion.usage, "cache_creation_input_tokens", 0) or 0)
            + (getattr(completion.usage, "cache_read_input_tokens", 0) or 0)
        )
        usage = {
            "input_tokens": input_total,
            "output_tokens": completion.usage.output_tokens,
        }
        history.append({"role": "assistant", "content": response_text})
        conversation_histories[context_id] = history
    except Exception as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        response_text = f"[{AGENT_NAME}] Error: {e}"

    return JSONResponse(
        content={
            "jsonrpc": "2.0",
            "result": {
                "kind": "task",
                "id": task_id,
                "contextId": context_id,
                "status": {"state": "completed"},
                "artifacts": [
                    {
                        "artifactId": str(uuid.uuid4()),
                        "parts": [{"kind": "text", "text": response_text}],
                    }
                ],
                "metadata": {
                    "usage": usage,
                    "model": MODEL,
                    "duration_ms": round(duration_ms, 1),
                },
            },
            "id": request_id,
        },
        status_code=200,
    )
