import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;
  @IsValid()
  constraint!:string;
  @IsString()
  password!: string;
}

