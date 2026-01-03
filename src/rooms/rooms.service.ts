import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room } from './schemas/room.schema';
import { UserLocation } from './schemas/user-location.schema';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectModel(Room.name) private roomModel: Model<Room>,
    @InjectModel(UserLocation.name)
    private userLocationModel: Model<UserLocation>,
  ) {}
  async addUserToRoom(roomId: string, userId: string): Promise<Room | null> {
    const room = await this.roomModel.findOneAndUpdate(
      { roomId },
      {
        $setOnInsert: { name: `Room ${roomId}` },
        $addToSet: { activeUsers: userId },
      },
      { upsert: true, new: true },
    );

    if (room) {
      this.logger.log(`User ${userId} added to room ${roomId} (DB)`);
    }
    return room;
  }

  // CRITICAL EVENT: Direct DB Write (Immediate Consistency)
  async removeUserFromRoom(
    roomId: string,
    userId: string,
  ): Promise<Room | null> {
    return this.roomModel.findOneAndUpdate(
      { roomId },
      { $pull: { activeUsers: userId } },
      { new: true },
    );
  }

  // READ OPERATION: Helper to get users
  async getRoomUsers(roomId: string): Promise<string[]> {
    const room = await this.roomModel.findOne({ roomId }).exec();
    return room ? room.activeUsers : [];
  }

  // READ OPERATION: Helper to get locations for initial load
  async getActiveLocationsInRoom(roomId: string): Promise<UserLocation[]> {
    const room = await this.roomModel.findOne({ roomId }).exec();
    if (!room) return [];

    // Get locations only for users currently in the room list
    return this.userLocationModel
      .find({
        roomId: roomId,
        userId: { $in: room.activeUsers },
      })
      .exec();
  }

  // BATCH JOB: Efficient Bulk Write from Redis Data
  async bulkUpdateUserLocations(locations: any[]): Promise<void> {
    if (!locations || locations.length === 0) return;

    const operations = locations.map((loc) => ({
      updateOne: {
        filter: { userId: loc.userId, roomId: loc.roomId },
        update: {
          $set: {
            x: loc.x,
            y: loc.y,
            username: loc.username,
            timestamp: new Date(loc.timestamp), // Ensure date format
          },
        },
        upsert: true,
      },
    }));

    try {
      const result = await this.userLocationModel.bulkWrite(operations);
      this.logger.debug(
        `Bulk write success: Modified ${result.modifiedCount}, Upserted ${result.upsertedCount}`,
      );
    } catch (error) {
      this.logger.error(`Bulk write failed: ${error.message}`);
      throw error;
    }
  }

  async updateUserLocation(
    updateData: UpdateLocationDto,
  ): Promise<UserLocation> {
    return this.userLocationModel.findOneAndUpdate(
      { userId: updateData.userId, roomId: updateData.roomId },
      { ...updateData, timestamp: new Date() },
      { upsert: true, new: true },
    );
  }
}
