import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { EventsService } from './events.service.js';
import { openSse } from './sse.js';

@Controller('/api/v1/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Long-lived SSE stream of the user's notifications. Starts with a
   * `snapshot` of in-flight indexing and analyses, then one `message` per event.
   */
  @UseGuards(JwtAuthGuard)
  @Get('/stream')
  stream(
    @Req() req: ExpressRequest & { user: AuthenticatedUser },
    @Res() res: ExpressResponse,
  ) {
    const sse = openSse(res);
    const userId = req.user.userId;
    sse.send('snapshot', this.events.snapshot(userId));
    const unsubscribe = this.events.subscribe(userId, (event) =>
      sse.send('message', event),
    );
    req.on('close', () => {
      unsubscribe();
      sse.dispose();
    });
  }
}
