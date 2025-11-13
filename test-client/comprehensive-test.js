import { io } from 'socket.io-client';

class LocationTrackerTest {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🧪 Running Comprehensive Tests...\n');
    
    for (const test of this.tests) {
      try {
        await test.fn();
        console.log(`✅ PASS: ${test.name}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ FAIL: ${test.name}`);
        console.log(`   Error: ${error.message}`);
        this.failed++;
      }
    }
    
    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

const testSuite = new LocationTrackerTest();

// Test 1: Basic Connection
testSuite.test('WebSocket Connection', async () => {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:3001', { timeout: 5000 });
    
    socket.on('connect', () => {
      socket.disconnect();
      resolve();
    });
    
    socket.on('connect_error', (error) => {
      reject(new Error(`Connection failed: ${error.message}`));
    });
    
    setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);
  });
});

// Test 2: Room Creation and Joining
testSuite.test('Room Creation and Joining', async () => {
  return new Promise((resolve, reject) => {
    const socket = io('http://localhost:3001');
    const testRoom = `test-room-${Date.now()}`;
    
    socket.on('connect', () => {
      socket.emit('joinRoom', {
        roomId: testRoom,
        userId: 'test-user-1',
        username: 'TestUser'
      });
    });
    
    socket.on('roomJoined', (data) => {
      if (data.roomId === testRoom && data.users.includes('test-user-1')) {
        socket.disconnect();
        resolve();
      } else {
        socket.disconnect();
        reject(new Error('Room join data incorrect'));
      }
    });
    
    socket.on('error', (error) => {
      socket.disconnect();
      reject(new Error(`Room join error: ${error.message}`));
    });
    
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('Room join timeout'));
    }, 5000);
  });
});

// Test 3: Location Updates
testSuite.test('Location Update Broadcasting', async () => {
  return new Promise((resolve, reject) => {
    const roomId = `location-test-${Date.now()}`;
    const socket1 = io('http://localhost:3001');
    const socket2 = io('http://localhost:3001');
    let user1Joined = false;
    let user2Joined = false;
    let locationReceived = false;
    
    socket1.on('roomJoined', () => {
      user1Joined = true;
      if (user2Joined) {
        socket1.emit('updateLocation', {
          roomId,
          userId: 'user-1',
          username: 'User1',
          x: 100,
          y: 200
        });
      }
    });
    
    socket2.on('roomJoined', () => {
      user2Joined = true;
      if (user1Joined) {
        socket1.emit('updateLocation', {
          roomId,
          userId: 'user-1',
          username: 'User1',
          x: 100,
          y: 200
        });
      }
    });
    
    socket2.on('locationUpdate', (data) => {
      if (data.userId === 'user-1' && data.x === 100 && data.y === 200) {
        locationReceived = true;
        socket1.disconnect();
        socket2.disconnect();
        resolve();
      }
    });
    
    // Both users join the same room
    socket1.on('connect', () => {
      socket1.emit('joinRoom', { roomId, userId: 'user-1', username: 'User1' });
    });
    
    socket2.on('connect', () => {
      socket2.emit('joinRoom', { roomId, userId: 'user-2', username: 'User2' });
    });
    
    setTimeout(() => {
      socket1.disconnect();
      socket2.disconnect();
      reject(new Error('Location broadcast timeout'));
    }, 10000);
  });
});

// Run all tests
testSuite.run();