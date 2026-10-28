import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import { chatRouter } from './routes/chat.routes';
import { userRouter } from './routes/user.routes';

export const app = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(chatRouter);
app.use(userRouter);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.use(errorHandler);
