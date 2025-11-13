import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

console.log('Connecting to WebSocket server...');

socket.on('connect', () => {
  console.log('‚úÖ Connected to server with ID:', socket.id);
  
  // Test 1: Join Room
  console.log('\nJoining room...');
  socket.emit('joinRoom', {
    roomId: 'test-room-1',
    userId: 'test-user-1',
    username: 'TestUser'
  });
});

socket.on('roomJoined', (data) => {
  console.log('‚úÖ Room joined successfully:', data);
  
  // Test 2: Update location
  console.log('\nUpdating location...');
  socket.emit('updateLocation', {
    roomId: 'test-room-1',
    userId: 'test-user-1',
    username: 'TestUser',
    x: 100,
    y: 200
  });
});

socket.on('locationUpdate', (data) => {
  console.log('Ì≥° Received location update:', data);
  
  // Test 3: Leave room after receiving update
  setTimeout(() => {
    console.log('\nLeaving room...');
    socket.emit('leaveRoom', { roomId: 'test-room-1' });
  }, 2000);
});

socket.on('userJoined', (data) => {
  console.log('Ì±§ User joined room:', data);
});

socket.on('userLeft', (data) => {
  console.log('Ì±ã User left room:', data);
});

socket.on('roomLeft', (data) => {
  console.log('‚úÖ Successfully left room:', data);
  console.log('\nÌæâ All tests completed!');
  process.exit(0);
});

socket.on('error', (error) => {
  console.error('‚ùå Error:', error);
});

socket.on('disconnect', () => {
  console.log('Ì¥å Disconnected from server');
});

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\nClosing connection...');
  socket.close();
  process.exit(0);
});

// Auto timeout after 10 seconds
setTimeout(() => {
  console.log('‚è∞ Test timeout');
  process.exit(1);
}, 10000);
