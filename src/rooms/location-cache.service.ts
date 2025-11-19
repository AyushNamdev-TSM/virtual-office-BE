import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RoomsService } from './rooms.service';

@Injectable()
export class LocationCacheService {
  private readonly logger = new Logger(LocationCacheService.name);
  private readonly LOCATIONS_KEY = 'user:locations'; // Hash: userId -> JSON Data
  private readonly DIRTY_SET_KEY = 'users:dirty'; // Set: userId
  
  // Phase 1: Minimum distance between users (e.g., 30px radius + 30px radius)
  private readonly COLLISION_RADIUS = 60; 

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly roomsService: RoomsService,
  ) {}
  async addRoomUser(roomId: string, userId: string) {
    await this.redis.sadd(`room:${roomId}:users`, userId);
  }

  async removeRoomUser(roomId: string, userId: string) {
    await this.redis.srem(`room:${roomId}:users`, userId);
  }

  // --- Phase 1: Collision Detection Logic ---
  async checkCollision(data: UpdateLocationDto): Promise<boolean> {
    const roomUsers = await this.redis.smembers(`room:${data.roomId}:users`);
    
    // Filter out the user moving (can't collide with self)
    const otherUsers = roomUsers.filter(id => id !== data.userId);
    if (otherUsers.length === 0) return false;

    // 2. Bulk fetch locations of these neighbors
    const rawLocations = await this.redis.hmget(this.LOCATIONS_KEY, ...otherUsers);
    
    // 3. Check Euclidean distance against every neighbor
    for (const raw of rawLocations) {
      if (!raw) continue;
      const loc = JSON.parse(raw);
      
      const distance = Math.sqrt(
        Math.pow(loc.x - data.x, 2) + 
        Math.pow(loc.y - data.y, 2)
      );

      if (distance < this.COLLISION_RADIUS) {
        return true; 
      }
    }

    return false; // Path is clear
  }

  // --- Existing Redis Caching Logic ---
  async cacheLocationUpdate(data: UpdateLocationDto): Promise<void> {
    const { userId } = data;
    
    // Store actual location data
    await this.redis.hset(
      this.LOCATIONS_KEY,
      userId,
      JSON.stringify({ ...data, timestamp: new Date() })
    );

    // Mark user as 'dirty' for MongoDB sync
    await this.redis.sadd(this.DIRTY_SET_KEY, userId);
  }

  // --- Existing Background Sync Logic ---
  @Cron('*/10 * * * * *')
  async syncLocationsToDatabase() {
    const dirtyUsers = await this.redis.smembers(this.DIRTY_SET_KEY);
    if (dirtyUsers.length === 0) return;

    this.logger.log(`🔄 Syncing ${dirtyUsers.length} users to MongoDB...`);

    const rawLocations = await this.redis.hmget(this.LOCATIONS_KEY, ...dirtyUsers);
    
    const updates = rawLocations
      .filter((raw) => raw !== null)
      .map((raw) => JSON.parse(raw));

    if (updates.length > 0) {
      await this.roomsService.bulkUpdateUserLocations(updates);
      
      // Cleanup dirty set
      await this.redis.srem(this.DIRTY_SET_KEY, ...dirtyUsers);
      
      this.logger.log(`✅ Synced ${updates.length} locations to DB.`);
    }
  }
}