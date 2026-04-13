import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: int;

  @IsString()
  password!: string;
}

