"""
A2A-compliant agent server template.

Run 3 instances of this server, one per persona:

    python -m uvicorn agent_server.main:app --port 8001  # Atlas
    python -m uvicorn agent_server.main:app --port 8002  # Sage
    python -m uvicorn agent_server.main:app --port 8003  # Bolt

Configure the agent via environment variables:
    AGENT_NAME    - e.g. "Atlas - Research"
    AGENT_SKILLS  - comma-separated, e.g. "general-knowledge,research"
    AGENT_PORT    - port number (used in agent card URL)
"""

import os
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

AGENT_NAME = os.environ.get("AGENT_NAME", "Atlas - Research")
AGENT_SKILLS = os.environ.get("AGENT_SKILLS", "general-knowledge,research").split(",")
AGENT_PORT = os.environ.get("AGENT_PORT", "8001")

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
    """Handle A2A JSON-RPC requests.

    Supports:
        - message/send: Process a user message and return a response

    TODO: Implement actual agent logic. Currently returns a placeholder.
    """
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
    """Handle message/send - the core A2A method.

    TODO: Replace the placeholder with actual agent logic.
    Use the A2A Python SDK, Google ADK, LangGraph, or direct Claude calls.

    The benchmark adapter looks for token usage in task metadata:
        metadata.usage = {"input_tokens": N, "output_tokens": N}
        metadata.model = "model-name"
        metadata.duration_ms = N

    Include these for accurate benchmark metrics.
    """
    message = params.get("message", {})
    parts = message.get("parts", [])
    user_text = " ".join(p.get("text", "") for p in parts if p.get("kind") == "text")
    context_id = message.get("contextId", str(uuid.uuid4()))
    task_id = message.get("taskId", str(uuid.uuid4()))

    # --- PLACEHOLDER: Replace with actual agent logic ---
    response_text = (
        f"[{AGENT_NAME}] Received: {user_text[:100]}... "
        "(placeholder - implement agent logic in handle_send_message)"
    )
    # --- END PLACEHOLDER ---

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
                # Custom metadata for benchmark token tracking
                "metadata": {
                    "usage": None,  # TODO: populate with actual token counts
                    "model": None,  # TODO: populate with model name
                    "duration_ms": None,  # TODO: populate with duration
                },
            },
            "id": request_id,
        },
        status_code=200,
    )
