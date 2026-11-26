import { startServer } from './server';

const srv = startServer();
srv.ready.then((port) => console.log(`304 server listening on http://localhost:${port}`));
