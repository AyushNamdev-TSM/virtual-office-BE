import { io } from 'socket.io-client';

const ROOM_ID = 'multi-test-room';
const USERS = [
  { id: 'user-1', name: 'Alice' },
  { id: 'user-2', name: 'Bob' },
  { id: 'user-3', name: 'Charlie' }
];

function createUser(user) {
  const socket = io('http://localhost:3000');
  
  socket.on('connect', () => {
    console.log(`âœ… ${user.name} connected`);
    
    // Join room
    socket.emit('joinRoom', {
      roomId: ROOM_ID,
      userId: user.id,
      username: user.name
    });
  });
  
  socket.on('roomJoined', () => {
    console.log(`í¿  ${user.name} joined room`);
    
    // Start moving randomly
    let x = Math.floor(Math.random() * 500);
    let y = Math.floor(Math.random() * 500);
    
    const moveInterval = setInterval(() => {
      x += (Math.random() - 0.5) * 20;
      y += (Math.random() - 0.5) * 20;
      
      socket.emit('updateLocation', {
        roomId: ROOM_ID,
        userId: user.id,
        username: user.name,
        x: Math.round(x),
        y: Math.round(y)
      });
    }, 1000);
    
    // Stop after 30 seconds
    setTimeout(() => {
      clearInterval(moveInterval);
      socket.emit('leaveRoom', { roomId: ROOM_ID });
      socket.disconnect();
      console.log(`í±‹ ${user.name} left and disconnected`);
    }, 30000);
  });
  
  socket.on('locationUpdate', (data) => {
    if (data.userId !== user.id) {
      console.log(`í³¡ ${user.name} sees ${data.username} at (${data.x}, ${data.y})`);
    }
  });
  
  socket.on('userJoined', (data) => {
    console.log(`í±€ ${user.name} sees ${data.username} joined`);
  });
  
  socket.on('userLeft', (data) => {
    console.log(`í±€ ${user.name} sees ${data.username} left`);
  });
  
  socket.on('error', (error) => {
    console.error(`âŒ ${user.name} error:`, error);
  });
}

console.log('íº€ Starting multi-user simulation...');
USERS.forEach(user => createUser(user));

// Auto-stop after 35 seconds
setTimeout(() => {
  console.log('\ní¾‰ Simulation completed!');
  process.exit(0);
}, 35000);
