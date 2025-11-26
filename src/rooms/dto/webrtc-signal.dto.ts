import { IsNotEmpty, IsString, IsObject } from 'class-validator';

export class WebRTCSignalDto {
  @IsString()
  @IsNotEmpty()
  toUserId: string;

  @IsObject()
  @IsNotEmpty()
  signal: any; // Contains the SDP or ICE Candidate object
}