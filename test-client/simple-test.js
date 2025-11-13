import { io } from 'socket.io-client';

console.log('🚀 Starting WebSocket connection test...');
console.log('📍 Connecting to: http://localhost:3001');

const socket = io('http://localhost:3001', {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  forceNew: true
});

// Listen for basic connection
socket.on('connect', () => {
  console.log('✅ CONNECTED to server! Socket ID:', socket.id);
  console.log('📡 Testing room joining...');
  
  // Test joining a room
  socket.emit('joinRoom', {
    roomId: 'test-room',
    userId: 'test-user-123',
    username: 'TestUser'
  });
});

// Listen for custom connected event from server
socket.on('connected', (data) => {
  console.log('✅ Server welcome:', data.message);
});

// Listen for room joined confirmation
socket.on('roomJoined', (data) => {
  console.log('✅ SUCCESS: Joined room!');
  console.log('📊 Room data:', {
    roomId: data.roomId,
    userCount: data.users.length,
    locationCount: data.locations.length
  });
  
  // Test sending location update
  setTimeout(() => {
    console.log('📍 Sending location update...');
    socket.emit('updateLocation', {
      roomId: 'test-room',
      userId: 'test-user-123',
      username: 'TestUser',
      x: 100,
      y: 200
    });
  }, 1000);
});

// Listen for location updates
socket.on('locationUpdate', (data) => {
  console.log('📍 Location update received:', {
    user: data.username,
    position: `(${data.x}, ${data.y})`,
    timestamp: data.timestamp
  });
});

// Listen for user events
socket.on('userJoined', (data) => {
  console.log('👤 User joined:', data.username);
});

socket.on('userLeft', (data) => {
  console.log('👋 User left:', data.username);
});

// Listen for room left confirmation
socket.on('roomLeft', (data) => {
  console.log('✅ Left room:', data.roomId);
});

// Listen for errors
socket.on('error', (error) => {
  console.log('❌ Server error:', error.message || error);
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection failed:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
});

// Extended timeout for debugging
setTimeout(() => {
  if (socket.connected) {
    console.log('✅ Test completed successfully');
    socket.disconnect();
  } else {
    console.log('❌ Test failed - no connection established');
  }
  process.exit(0);
}, 15000);