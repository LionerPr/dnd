import { handleRequest, type Env } from './app.js';

export { Room } from './realtime.js';

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx),
} satisfies ExportedHandler<Env>;
