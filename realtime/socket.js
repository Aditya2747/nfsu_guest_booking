import { Server } from 'socket.io';

let ioInstance = null;

export function initSocket(httpServer, options) {
  ioInstance = new Server(httpServer, options);

  ioInstance.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => socket.join(`room:${roomId}`));
    socket.on('leaveRoom', (roomId) => socket.leave(`room:${roomId}`));
  });

  return ioInstance;
}

export function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized');
  }
  return ioInstance;
}


