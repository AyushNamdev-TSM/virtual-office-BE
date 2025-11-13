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
import { JoinRoomDto } from './dto/join-room.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@UsePipes(new ValidationPipe()) // Automatically validates all DTOs
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RoomsGateway.name);
  private userRooms = new Map<string, string>(); // Map<socketId, roomId>

  constructor(private readonly roomsService: RoomsService) {}

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway Initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`✅ Client connected: ${client.id}`);
    client.emit('connected', {
      message: 'Welcome to Location Tracking Server',
    });
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
    const roomId = this.userRooms.get(client.id);

    if (roomId) {
      const userId = client.data.userId;
      if (userId) {
        await this.roomsService.removeUserFromRoom(roomId, userId);
        // We can also remove their location data on disconnect
        // await this.roomsService.removeUserLocation(userId, roomId);

        this.server.to(roomId).emit('userLeft', {
          userId,
          username: client.data.username,
        });
        this.logger.log(
          `User ${userId} (${client.data.username}) left room ${roomId}`,
        );
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
      this.logger.log(`📥 Join room request: ${data.username} -> ${data.roomId}`);
      
      client.data.userId = data.userId;
      client.data.username = data.username;

      const room = await this.roomsService.addUserToRoom(
        data.roomId,
        data.userId,
      );
      if (!room) {
        throw new WsException('Could not join or create room');
      }

      client.join(data.roomId);
      this.userRooms.set(client.id, data.roomId);

      const users = await this.roomsService.getRoomUsers(data.roomId);
      const locations = await this.roomsService.getActiveLocationsInRoom(data.roomId);

      client.emit('roomJoined', {
        roomId: data.roomId,
        users,
        locations,
      });

      client.to(data.roomId).emit('userJoined', {
        userId: data.userId,
        username: data.username,
      });

      this.logger.log(`✅ User ${data.username} joined room ${data.roomId}`);
    } catch (error) {
      this.logger.error(`Error joining room: ${error.message}`);
      client.emit('error', {
        message: 'Failed to join room',
        error: error.message,
      });
      throw new WsException(error.message);
    }
  }

  @SubscribeMessage('updateLocation')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateLocationDto,
  ) {
    try {
      const roomId = this.userRooms.get(client.id);
      if (!roomId || roomId !== data.roomId) {
        throw new WsException('User is not in the specified room');
      }

      await this.roomsService.updateUserLocation(data);

      this.server.to(data.roomId).emit('locationUpdate', {
        userId: data.userId,
        username: data.username,
        x: data.x,
        y: data.y,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Error updating location: ${error.message}`);
      client.emit('error', {
        message: 'Failed to update location',
        error: error.message,
      });
      throw new WsException(error.message);
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
        await this.roomsService.removeUserFromRoom(data.roomId, userId);
        client.leave(data.roomId);
        this.userRooms.delete(client.id);

        this.server.to(data.roomId).emit('userLeft', {
          userId,
          username: client.data.username,
        });

        client.emit('roomLeft', { roomId: data.roomId });
        this.logger.log(`🚪 User ${userId} left room ${data.roomId}`);
      }
    } catch (error) {
      this.logger.error(`Error leaving room: ${error.message}`);
      throw new WsException(error.message);
    }
  }
}