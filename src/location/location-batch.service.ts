import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserLocation } from '../rooms/schemas/user-location.schema';
import { Server } from 'socket.io';

type QueuedLocation = {
  userId: string;
  roomId: string;
  username: string;
  x: number;
  y: number;
  timestamp: Date;
};

@Injectable()
export class LocationBatchService implements OnModuleInit, OnModuleDestroy {
  private locationBuffer = new Map<string, QueuedLocation>(); // key: ${userId}:${roomId}
  private readonly BATCH_INTERVAL = Number(process.env.BATCH_INTERVAL_MS || 500);
  private readonly MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || 100);
  private batchInterval: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  private readonly logger = new Logger(LocationBatchService.name);

  constructor(
    @InjectModel(UserLocation.name) private userLocationModel: Model<UserLocation>,
  ) {}

  onModuleInit() {
    this.logger.log('🚀 LocationBatchService initialized');
    this.batchInterval = setInterval(() => {
      void this.processBatch();
    }, this.BATCH_INTERVAL);
  }

  onModuleDestroy() {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
      void this.processBatch(); // Flush remaining
    }
  }

  // Bound by RoomsGateway.afterInit
  setServer(server: Server) {
    this.server = server;
    this.logger.log('🔌 Socket server bound to LocationBatchService');
  }

  queueLocationUpdate(userId: string, roomId: string, username: string, x: number, y: number): void {
    const key = `${userId}:${roomId}`;
    this.locationBuffer.set(key, { userId, roomId, username, x, y, timestamp: new Date() });

    if (this.locationBuffer.size >= this.MAX_BATCH_SIZE) {
      void this.processBatch();
    }
  }

  private async processBatch(): Promise<void> {
    if (this.locationBuffer.size === 0) {
      return;
    }

    // Snapshot then clear buffer to accept new updates immediately
    const snapshot = Array.from(this.locationBuffer.values());
    this.locationBuffer.clear();

    // Keep only the latest per user-room
    const latest = new Map<string, QueuedLocation>();
    for (const u of snapshot) {
      latest.set(`${u.userId}:${u.roomId}`, u);
    }

    const updates = Array.from(latest.values());
    const count = updates.length;

    try {
      // Bulk upsert
      const bulkOps = updates.map(u => ({
        updateOne: {
          filter: { userId: u.userId, roomId: u.roomId },
          update: { $set: { userId: u.userId, roomId: u.roomId, username: u.username, x: u.x, y: u.y, timestamp: u.timestamp } },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        const result = await this.userLocationModel.bulkWrite(bulkOps, { ordered: false });
        this.logger.debug(`📦 Processed ${count} location updates (modified: ${result.modifiedCount ?? 0}, upserted: ${result.upsertedCount ?? 0})`);
      }

      // Group by roomId for broadcast
      const roomGroups = new Map<string, QueuedLocation[]>();
      for (const u of updates) {
        if (!roomGroups.has(u.roomId)) roomGroups.set(u.roomId, []);
        roomGroups.get(u.roomId)!.push(u);
      }

      // Broadcast if server is present
      if (!this.server) {
        this.logger.warn('⚠️ Socket server not set; skipping broadcast this tick');
        return;
      }

      roomGroups.forEach((list, roomId) => {
        // Note: This broadcasts every single update.
        // For high traffic, consider broadcasting the full list:
        // this.server!.to(roomId).emit('locationUpdates', list);
        for (const u of list) {
          this.server!.to(roomId).emit('locationUpdate', {
            userId: u.userId,
            username: u.username,
            x: u.x,
            y: u.y,
            timestamp: u.timestamp,
          });
        }
      });
    } catch (err: any) {
      this.logger.error(`❌ Batch processing error: ${err?.message || err}`);
    }
  }

  async flushImmediate(): Promise<void> {
    await this.processBatch();
  }

  getBufferStats() {
    return {
      bufferedUpdates: this.locationBuffer.size,
      maxBatchSize: this.MAX_BATCH_SIZE,
      batchInterval: this.BATCH_INTERVAL,
      serverBound: !!this.server,
    };
  }
}