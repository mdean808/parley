import type { RequestHandler } from "./$types";
import {
	getSession,
	addSessionListener,
	removeSessionListener,
} from "$lib/server/sessions";
import type { ChatStreamListener } from "$lib/server/sessions";

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get("sessionId");
	if (!sessionId) {
		return new Response("Missing sessionId", { status: 400 });
	}

	const session = getSession(sessionId);
	if (!session) {
		return new Response("Session not found", { status: 404 });
	}

	const encoder = new TextEncoder();
	let activeListener: ChatStreamListener | null = null;

	const stream = new ReadableStream({
		start(controller) {
			activeListener = (event) => {
				try {
					const data = `data: ${JSON.stringify(event)}\n\n`;
					controller.enqueue(encoder.encode(data));
				} catch {
					// stream may be closed
				}
			};

			addSessionListener(sessionId, activeListener);
			controller.enqueue(encoder.encode(": connected\n\n"));
		},
		cancel() {
			if (activeListener) {
				removeSessionListener(sessionId, activeListener);
				activeListener = null;
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
};
