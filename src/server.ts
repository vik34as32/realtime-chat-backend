import http from 'http';
import 'dotenv/config';
import { setupDatabase } from './config/db';
import { jwtSecret } from './utils/jwt';

const portValue = process.env.PORT ?? '3000';

if (!/^\d+$/.test(portValue)) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

const port = Number(portValue);

if (port <= 0 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

async function start(): Promise<void> {
  jwtSecret();
  await setupDatabase();

  const { app } = await import('./app');
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use. Close the other server, then run npm run dev again.`,
          ),
        );
        return;
      }

      reject(error);
    });

    server.listen(port, () => {
      console.log(`Server is running on port ${port}`);
      resolve();
    });
  });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Server failed to start';

  if (message.includes('already in use') || message.includes('JWT_SECRET')) {
    console.error(message);
  } else {
    console.error('Database connection failed');
    console.error(message);
  }

  process.exit(1);
});
