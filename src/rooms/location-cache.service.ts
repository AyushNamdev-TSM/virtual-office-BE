import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RoomsService } from './rooms.service';

@Injectable()
export class LocationCacheService {
  private readonly logger = new Logger(LocationCacheService.name);
  private readonly LOCATIONS_KEY = 'user:locations';
  private readonly DIRTY_SET_KEY = 'users:dirty';
  private readonly COLLISION_RADIUS = 60;
  private readonly PROXIMITY_RADIUS = 150;
  
  // Garbage Collection: Remove users inactive for 30s
  private readonly STALE_USER_THRESHOLD_MS = 30000; 

  private server: Server;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly roomsService: RoomsService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  async addRoomUser(roomId: string, userId: string) {
    await this.redis.sadd(`room:${roomId}:users`, userId);
    await this.redis.sadd('active_rooms', roomId);
  }

  async removeRoomUser(roomId: string, userId: string) {
    await this.redis.srem(`room:${roomId}:users`, userId);
    const count = await this.redis.scard(`room:${roomId}:users`);
    if (count === 0) await this.redis.srem('active_rooms', roomId);
    await this.redis.del(`user:${userId}:neighbors`);
    await this.redis.hdel(this.LOCATIONS_KEY, userId);
  }

  async checkCollision(data: UpdateLocationDto): Promise<boolean> {
    const roomUsers = await this.redis.smembers(`room:${data.roomId}:users`);
    const otherUsers = roomUsers.filter((id) => id !== data.userId);
    if (otherUsers.length === 0) return false;

    const rawLocations = await this.redis.hmget(
      this.LOCATIONS_KEY,
      ...otherUsers,
    );

    for (const raw of rawLocations) {
      if (!raw) continue;
      const loc = JSON.parse(raw);
      const distance = Math.sqrt(
        Math.pow(loc.x - data.x, 2) + Math.pow(loc.y - data.y, 2),
      );
      if (distance < this.COLLISION_RADIUS) return true;
    }
    return false;
  }

  async cacheLocationUpdate(data: UpdateLocationDto): Promise<void> {
    await this.redis.hset(
      this.LOCATIONS_KEY,
      data.userId,
      JSON.stringify({ ...data, timestamp: new Date() }),
    );
    await this.redis.sadd(this.DIRTY_SET_KEY, data.userId);
  }

  @Cron('*/1 * * * * *')
  async processProximityChecks() {
    if (!this.server) return;

    const activeRooms = await this.redis.smembers('active_rooms');
    const now = Date.now();

    for (const roomId of activeRooms) {
      const userIds = await this.redis.smembers(`room:${roomId}:users`);
      if (userIds.length === 0) continue;

      const rawData = await this.redis.hmget(this.LOCATIONS_KEY, ...userIds);
      
      // Explicitly typed arrays to fix TS errors
      const users: any[] = [];
      const staleUsers: string[] = [];

      // 1. Filter Stale vs Active
      userIds.forEach((userId, index) => {
        const raw = rawData[index];
        if (!raw) return;

        const user = JSON.parse(raw);
        const lastUpdate = new Date(user.timestamp).getTime();

        if (now - lastUpdate > this.STALE_USER_THRESHOLD_MS) {
            staleUsers.push(userId);
        } else {
            users.push(user);
        }
      });

      // 2. Cleanup Stale Users
      if (staleUsers.length > 0) {
        // this.logger.log(`🧹 Removing ${staleUsers.length} stale users from room ${roomId}`);
        for (const staleId of staleUsers) {
            await this.removeRoomUser(roomId, staleId);
            this.server.to(roomId).emit('userLeft', { userId: staleId });
        }
      }

      // 3. Process Proximity
      if (users.length < 2) continue;

      for (let i = 0; i < users.length; i++) {
        const userA = users[i];
        const nearbyUsers: any[] = [];

        for (let j = 0; j < users.length; j++) {
          if (i === j) continue;
          const userB = users[j];

          const distance = Math.sqrt(
            Math.pow(userA.x - userB.x, 2) + Math.pow(userA.y - userB.y, 2),
          );

          if (distance <= this.PROXIMITY_RADIUS) {
            nearbyUsers.push(userB);
          }
        }

        await this.handleProximityState(userA, nearbyUsers);
      }
    }
  }

  private async handleProximityState(
    currentUser: any,
    currentNeighbors: any[],
  ) {
    const key = `user:${currentUser.userId}:neighbors`;
    const previousNeighborIds = await this.redis.smembers(key);

    const currentNeighborIds = currentNeighbors.map((u) => u.userId);
    const currentSet = new Set(currentNeighborIds);
    const prevSet = new Set(previousNeighborIds);

    const newNeighborIds = currentNeighborIds.filter((id) => !prevSet.has(id));
    const leftNeighborIds = previousNeighborIds.filter((id) => !currentSet.has(id));

    if (newNeighborIds.length > 0 || leftNeighborIds.length > 0) {
      
      if (newNeighborIds.length > 0) {
        const richPayload = currentNeighbors
          .filter((u) => newNeighborIds.includes(u.userId))
          .map((u) => ({
            userId: u.userId,
            username: u.username,
            distance: Math.round(
              Math.sqrt(
                Math.pow(currentUser.x - u.x, 2) +
                Math.pow(currentUser.y - u.y, 2)
              ),
            ),
          }));

        this.server.to(currentUser.userId).emit('proximity-alert', {
          type: 'new',
          users: richPayload,
        });
      }

      if (leftNeighborIds.length > 0) {
        this.server.to(currentUser.userId).emit('proximity-clear', {
          type: 'left',
          userIds: leftNeighborIds,
        });
      }

      if (currentNeighborIds.length > 0) {
        await this.redis.del(key);
        await this.redis.sadd(key, ...currentNeighborIds);
      } else {
        await this.redis.del(key);
      }
    }
  }

  @Cron('*/10 * * * * *')
  async syncLocationsToDatabase() {
    const dirtyUsers = await this.redis.smembers(this.DIRTY_SET_KEY);
    if (dirtyUsers.length === 0) return;

    const rawLocations = await this.redis.hmget(this.LOCATIONS_KEY, ...dirtyUsers);
    
    // Type guard to fix TS error
    const updates = rawLocations
      .filter((raw): raw is string => raw !== null)
      .map((raw) => JSON.parse(raw));

    if (updates.length > 0) {
      await this.roomsService.bulkUpdateUserLocations(updates);
      await this.redis.srem(this.DIRTY_SET_KEY, ...dirtyUsers);
    }
  }
}