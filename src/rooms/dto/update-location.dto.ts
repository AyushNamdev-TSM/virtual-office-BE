import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsNumber()
  @Min(0)
  @Max(10000) // Assuming a max map size
  x: number;

  @IsNumber()
  @Min(0)
  @Max(10000) // Assuming a max map size
  y: number;
}