import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import { LocationCacheService } from './location-cache.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RoomsGateway.name);
  
  // Map<socketId, roomId> for disconnect handling
  private userRooms = new Map<string, string>();

  constructor(
    private readonly roomsService: RoomsService,
    private readonly locationCacheService: LocationCacheService,
  ) {}

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway Initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`✅ Client connected: ${client.id}`);
    client.emit('connected', { message: 'Connected to Location Server' });
  }

  async handleDisconnect(client: Socket) {
    const roomId = this.userRooms.get(client.id);
    if (roomId) {
      const userId = client.data.userId;
      if (userId) {
        // 1. DB Cleanup (Critical)
        await this.roomsService.removeUserFromRoom(roomId, userId);
        
        // 2. Redis Room Set Cleanup (Phase 1)
        await this.locationCacheService.removeRoomUser(roomId, userId);

        this.server.to(roomId).emit('userLeft', {
          userId,
          username: client.data.username,
        });
        this.logger.log(`User ${userId} disconnected from ${roomId}`);
      }
      this.userRooms.delete(client.id);
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomDto,
  ) {
    try {
      client.data.userId = data.userId;
      client.data.username = data.username;

      // 1. DB Join (Critical)
      const room = await this.roomsService.addUserToRoom(
        data.roomId,
        data.userId,
      );
      if (!room) throw new WsException('Could not join room');

      // 2. Redis Room Set Registration (Phase 1)
      await this.locationCacheService.addRoomUser(data.roomId, data.userId);

      client.join(data.roomId);
      this.userRooms.set(client.id, data.roomId);

      const users = await this.roomsService.getRoomUsers(data.roomId);
      const locations = await this.roomsService.getActiveLocationsInRoom(data.roomId);

      client.emit('roomJoined', { roomId: data.roomId, users, locations });
      
      client.to(data.roomId).emit('userJoined', {
        userId: data.userId,
        username: data.username,
      });

      this.logger.log(`User ${data.userId} joined ${data.roomId}`);
    } catch (error) {
      this.logger.error(`Join Room Error: ${error.message}`);
      client.emit('error', { message: 'Failed to join room' });
    }
  }

  @SubscribeMessage('updateLocation')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateLocationDto,
  ) {
    try {
      const roomId = this.userRooms.get(client.id);
      if (!roomId || roomId !== data.roomId) return;

      const isColliding = await this.locationCacheService.checkCollision(data);
      
      if (isColliding) {
        // Reject the move
        client.emit('movementRejected', { 
            reason: 'Collision detected', 
            x: data.x, 
            y: data.y 
        });
        return; // Stop processing (do not update cache or broadcast)
      }

      // If no collision, proceed with Cache & Broadcast
      await this.locationCacheService.cacheLocationUpdate(data);

      this.server.to(data.roomId).emit('locationUpdate', {
        userId: data.userId,
        username: data.username,
        x: data.x,
        y: data.y,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Location Update Error: ${error.message}`);
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    try {
      const userId = client.data.userId;
      if (userId && data.roomId) {
        // 1. DB Cleanup
        await this.roomsService.removeUserFromRoom(data.roomId, userId);
        
        // 2. Redis Cleanup (Phase 1)
        await this.locationCacheService.removeRoomUser(data.roomId, userId);
        
        client.leave(data.roomId);
        this.userRooms.delete(client.id);

        this.server.to(data.roomId).emit('userLeft', {
          userId,
          username: client.data.username,
        });
        
        client.emit('roomLeft', { roomId: data.roomId });
      }
    } catch (error) {
      this.logger.error(`Leave Room Error: ${error.message}`);
    }
  }
}