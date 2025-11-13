import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { Room } from '../rooms/schemas/room.schema';
import { UserLocation } from '../rooms/schemas/user-location.schema';

describe('RoomsGateway', () => {
  let gateway: RoomsGateway;
  let service: RoomsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsGateway,
        RoomsService,
        {
          provide: getModelToken(Room.name),
          useValue: {},
        },
        {
          provide: getModelToken(UserLocation.name),
          useValue: {},
        },
      ],
    }).compile();

    gateway = module.get<RoomsGateway>(RoomsGateway);
    service = module.get<RoomsService>(RoomsService);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});