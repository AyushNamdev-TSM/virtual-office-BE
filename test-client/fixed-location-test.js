import { io } from 'socket.io-client';

class FixedLocationTest {
  constructor() {
    this.results = [];
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async testLocationBroadcasting() {
    return new Promise(async (resolve, reject) => {
      const roomId = `broadcast-test-${Date.now()}`;
      this.log(`Testing room: ${roomId}`);
      
      let user1Connected = false;
      let user2Connected = false;
      let locationUpdateSent = false;
      let locationUpdateReceived = false;

      // Create first user
      const user1 = io('http://localhost:3001', {
        transports: ['websocket', 'polling']
      });

      user1.on('connect', () => {
        this.log('✅ User1 connected');
        user1.emit('joinRoom', {
          roomId: roomId,
          userId: 'broadcast-user-1',
          username: 'BroadcastUser1'
        });
      });

      user1.on('roomJoined', (data) => {
        this.log('✅ User1 joined room');
        user1Connected = true;
        if (user2Connected) {
          this.sendLocationUpdate(user1);
        }
      });

      // Create second user
      const user2 = io('http://localhost:3001', {
        transports: ['websocket', 'polling']
      });

      user2.on('connect', () => {
        this.log('✅ User2 connected');
        user2.emit('joinRoom', {
          roomId: roomId,
          userId: 'broadcast-user-2',
          username: 'BroadcastUser2'
        });
      });

      user2.on('roomJoined', (data) => {
        this.log('✅ User2 joined room');
        user2Connected = true;
        if (user1Connected) {
          this.sendLocationUpdate(user1);
        }
      });

      // Listen for location updates on user2
      user2.on('locationUpdate', (data) => {
        this.log(`📍 User2 received location update: ${data.username} at (${data.x}, ${data.y})`);
        
        if (data.userId === 'broadcast-user-1' && data.x === 150 && data.y === 250) {
          locationUpdateReceived = true;
          this.log('✅ SUCCESS: Location broadcast working correctly!');
          this.cleanup([user1, user2]);
          resolve(true);
        }
      });

      // Send location update
      this.sendLocationUpdate = (socket) => {
        if (!locationUpdateSent) {
          locationUpdateSent = true;
          this.log('📍 Sending location update from User1...');
          socket.emit('updateLocation', {
            roomId: roomId,
            userId: 'broadcast-user-1',
            username: 'BroadcastUser1',
            x: 150,
            y: 250
          });
        }
      };

      // Error handling
      const errorHandler = (user, error) => {
        this.log(`❌ Error for ${user}: ${error.message || error}`);
        this.cleanup([user1, user2]);
        reject(error);
      };

      user1.on('error', (error) => errorHandler('User1', error));
      user2.on('error', (error) => errorHandler('User2', error));
      user1.on('connect_error', (error) => errorHandler('User1', error));
      user2.on('connect_error', (error) => errorHandler('User2', error));

      // Timeout
      setTimeout(() => {
        if (!locationUpdateReceived) {
          this.log('❌ FAIL: Location broadcast timeout');
          this.log(`   User1 connected: ${user1Connected}`);
          this.log(`   User2 connected: ${user2Connected}`);
          this.log(`   Location sent: ${locationUpdateSent}`);
          this.log(`   Location received: ${locationUpdateReceived}`);
          this.cleanup([user1, user2]);
          reject(new Error('Location broadcast timeout - check server logs for details'));
        }
      }, 10000);

      // Cleanup function
      this.cleanup = (sockets) => {
        sockets.forEach(socket => {
          if (socket && socket.connected) {
            socket.disconnect();
          }
        });
      };
    });
  }

  async run() {
    console.log('🧪 Running Fixed Location Broadcast Test...\n');
    
    try {
      await this.testLocationBroadcasting();
      console.log('\n🎉 ALL TESTS PASSED! Location broadcasting is working correctly.');
      process.exit(0);
    } catch (error) {
      console.log(`\n💥 TEST FAILED: ${error.message}`);
      console.log('\n🔧 Check your server logs for more details about what went wrong.');
      process.exit(1);
    }
  }
}

// Run the test
new FixedLocationTest().run();