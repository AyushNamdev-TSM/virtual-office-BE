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

  async getRoom(roomId: string): Promise<Room | null> {
    return this.roomModel.findOne({ roomId }).exec();
  }

  async addUserToRoom(roomId: string, userId: string): Promise<Room | null> {
    const room = await this.roomModel.findOneAndUpdate(
      { roomId },
      { $setOnInsert: { name: `Room ${roomId}` }, $addToSet: { activeUsers: userId } },
      { upsert: true, new: true },
    );

    if (room) {
      this.logger.log(`User ${userId} added to room ${roomId}`);
    }
    return room;
  }

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

  async updateUserLocation(
    updateData: UpdateLocationDto,
  ): Promise<UserLocation> {
    return this.userLocationModel.findOneAndUpdate(
      { userId: updateData.userId, roomId: updateData.roomId },
      {
        username: updateData.username,
        x: updateData.x,
        y: updateData.y,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getRoomUsers(roomId: string): Promise<string[]> {
    const room = await this.getRoom(roomId);
    return room ? room.activeUsers : [];
  }

  async getActiveLocationsInRoom(
    roomId: string,
  ): Promise<UserLocation[]> {
    const room = await this.getRoom(roomId);
    if (!room) {
      return [];
    }
    
    // Find locations for users who are currently active in the room
    return this.userLocationModel
      .find({
        roomId: roomId,
        userId: { $in: room.activeUsers },
      })
      .exec();
  }

  async removeUserLocation(userId: string, roomId: string) {
    await this.userLocationModel.deleteOne({ userId, roomId });
    this.logger.log(`Removed location data for ${userId} in ${roomId}`);
  }
}