import { IsNotEmpty, IsString, Length } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  roomId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  userId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  username: string;
}