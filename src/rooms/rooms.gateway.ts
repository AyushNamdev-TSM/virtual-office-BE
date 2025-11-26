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
import { CallRequestDto } from './dto/call-request.dto';
import { CallAcceptedDto } from './dto/call-accepted.dto';
import { WebRTCSignalDto } from './dto/webrtc-signal.dto';

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RoomsGateway.name);
  private userRooms = new Map<string, string>();

  constructor(
    private readonly roomsService: RoomsService,
    private readonly locationCacheService: LocationCacheService,
  ) {}

  afterInit() {
    this.logger.log('🚀 WebSocket Gateway Initialized');
    this.locationCacheService.setServer(this.server);
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
        await this.roomsService.removeUserFromRoom(roomId, userId);
        await this.locationCacheService.removeRoomUser(roomId, userId);
        this.server.to(roomId).emit('userLeft', { userId });
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

      await this.roomsService.addUserToRoom(data.roomId, data.userId);
      await this.locationCacheService.addRoomUser(data.roomId, data.userId);

      client.join(data.roomId);
      client.join(data.userId); // Private channel for direct messages
      this.userRooms.set(client.id, data.roomId);

      const locations = await this.roomsService.getActiveLocationsInRoom(data.roomId);
      client.emit('roomJoined', { roomId: data.roomId, locations });
      client.to(data.roomId).emit('userJoined', data);
      
      this.logger.log(`User ${data.username} joined ${data.roomId}`);
    } catch (error) {
      this.logger.error(`Join Room Error: ${error.message}`);
      throw new WsException(error.message);
    }
  }

  @SubscribeMessage('updateLocation')
  async handleUpdateLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateLocationDto,
  ) {
    const roomId = this.userRooms.get(client.id);
    if (!roomId || roomId !== data.roomId) return;

    const isColliding = await this.locationCacheService.checkCollision(data);
    if (isColliding) {
      client.emit('movementRejected', { x: data.x, y: data.y });
      return;
    }

    await this.locationCacheService.cacheLocationUpdate(data);
    this.server.to(data.roomId).emit('locationUpdate', data);
  }

  @SubscribeMessage('call-request')
  async handleCallRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CallRequestDto,
  ) {
    const callerId = client.data.userId;
    if (callerId === data.targetUserId) return;
    
    this.logger.log(`📞 Call Request: ${client.data.username} -> ${data.targetUserId}`);

    this.server.to(data.targetUserId).emit('incoming-call', {
      callerId,
      callerName: client.data.username,
    });
    client.emit('call-sent', { targetId: data.targetUserId });
  }

  @SubscribeMessage('call-accepted')
  async handleCallAccepted(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CallAcceptedDto,
  ) {
    const accepterId = client.data.userId;
    const callerId = data.callerId;
    const callRoomId = `call_${callerId}_${accepterId}`;

    this.logger.log(`✅ Call Accepted: ${callerId} <-> ${accepterId}`);

    this.server.to(callerId).emit('call-ready', {
      callRoomId,
      remoteUserId: accepterId,
      isInitiator: true 
    });
    client.emit('call-ready', {
      callRoomId,
      remoteUserId: callerId,
      isInitiator: false 
    });
  }

  @SubscribeMessage('call-ended')
  async handleCallEnded(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { toUserId: string },
  ) {
    this.logger.log(`Call ended by ${client.data.username} -> ${data.toUserId}`);
    
    this.server.to(data.toUserId).emit('call-ended', {
      enderId: client.data.userId,
      enderName: client.data.username,
    });
  }

  // --- WebRTC Relay Handlers (Critical for Phase 6) ---

  @SubscribeMessage('webrtc-offer')
  async handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: WebRTCSignalDto,
  ) {
    this.server.to(data.toUserId).emit('webrtc-offer', {
      senderId: client.data.userId,
      offer: data.signal,
    });
  }

  @SubscribeMessage('webrtc-answer')
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: WebRTCSignalDto,
  ) {
    this.server.to(data.toUserId).emit('webrtc-answer', {
      senderId: client.data.userId,
      answer: data.signal,
    });
  }

  @SubscribeMessage('webrtc-ice-candidate')
  async handleIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: WebRTCSignalDto,
  ) {
    this.server.to(data.toUserId).emit('webrtc-ice-candidate', {
      senderId: client.data.userId,
      candidate: data.signal,
    });
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
        await this.locationCacheService.removeRoomUser(data.roomId, userId);
        
        client.leave(data.roomId);
        client.leave(userId);
        this.userRooms.delete(client.id);

        this.server.to(data.roomId).emit('userLeft', { userId });
        client.emit('roomLeft', { roomId: data.roomId });
      }
    } catch (error) {
      this.logger.error(`Leave Room Error: ${error.message}`);
    }
  }
}