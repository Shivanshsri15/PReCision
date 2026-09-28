import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Pre-cision is live - Version 1.0.0 - Please refer to the README.md for the API endpoints - https://github.com/Shivanshsri15/PReCision!';
  }
}
