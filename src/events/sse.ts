import type { Response } from 'express';

const HEARTBEAT_MS = 20_000;

/** Prepares `res` for Server-Sent Events and returns a writer plus a cleanup fn. */
export function openSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  return {
    send(event: string, data: unknown) {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
    dispose() {
      clearInterval(heartbeat);
    },
  };
}
