import { IsNotEmpty, IsString } from 'class-validator';

export class CallRequestDto {
  @IsString()
  @IsNotEmpty()
  targetUserId: string;
}