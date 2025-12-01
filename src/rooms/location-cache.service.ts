import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RoomsService } from './rooms.service';

@Injectable()
export class LocationCacheService implements OnModuleInit {
  private readonly logger = new Logger(LocationCacheService.name);
  private readonly LOCATIONS_KEY = 'user:locations';
  private readonly DIRTY_SET_KEY = 'users:dirty';
  private readonly COLLISION_RADIUS = 60;
  private readonly PROXIMITY_RADIUS = 150;
  
  // REMOVED: STALE_USER_THRESHOLD_MS logic as requested.
  // Users will strictly persist until disconnect or server restart.

  private server: Server;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly roomsService: RoomsService,
  ) {}

  // Keeps the DB clean on server restarts (Solves the "3 hours back" ghost user issue)
  async onModuleInit() {
    this.logger.warn('🧹 Startup: Flushing Redis to remove old ghosts...');
    await this.redis.flushdb();
  }

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

  // --- The Radar ---
  @Cron('*/1 * * * * *') // Runs every 1 second
  async processProximityChecks() {
    if (!this.server) return;

    const activeRooms = await this.redis.smembers('active_rooms');
    // const now = Date.now(); // Time check removed

    for (const roomId of activeRooms) {
      const userIds = await this.redis.smembers(`room:${roomId}:users`);
      
      if (userIds.length === 0) {
          await this.redis.srem('active_rooms', roomId);
          continue;
      }

      const rawData = await this.redis.hmget(this.LOCATIONS_KEY, ...userIds);
      
      const users: any[] = [];

      // 1. Parse Users (No Stale Check)
      userIds.forEach((userId, index) => {
        const raw = rawData[index];
        if (!raw) return; // Skip if data is missing/corrupt

        const user = JSON.parse(raw);
        users.push(user);
      });

      // 2. Proximity Logic
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
    
    const updates = rawLocations
      .filter((raw): raw is string => raw !== null)
      .map((raw) => JSON.parse(raw));

    if (updates.length > 0) {
      await this.roomsService.bulkUpdateUserLocations(updates);
      await this.redis.srem(this.DIRTY_SET_KEY, ...dirtyUsers);
    }
  }
}