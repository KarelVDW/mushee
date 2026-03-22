import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from './auth';

@Controller('api/auth')
export class AuthController {
  @All('*')
  async handleAuth(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const response = await auth.handler(
      new Request(new URL(req.url, `http://${req.hostname}`), {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method !== 'GET' && req.method !== 'HEAD'
          ? JSON.stringify(req.body)
          : undefined,
      }),
    );

    response.headers.forEach((value, key) => {
      res.header(key, value);
    });

    res.status(response.status).send(await response.text());
  }
}
