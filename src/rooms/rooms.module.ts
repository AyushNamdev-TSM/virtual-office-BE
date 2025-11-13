import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { Room, RoomSchema } from './schemas/room.schema';
import {
  UserLocation,
  UserLocationSchema,
} from './schemas/user-location.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: UserLocation.name, schema: UserLocationSchema },
    ]),
  ],
  providers: [RoomsGateway, RoomsService],
})
export class RoomsModule {}