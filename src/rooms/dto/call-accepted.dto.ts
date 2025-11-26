import { IsNotEmpty, IsString } from 'class-validator';

export class CallAcceptedDto {
  @IsString()
  @IsNotEmpty()
  callerId: string;
}