import { Module } from '@nestjs/common';
import { PrDetectionLabController } from './pr-detection-lab.controller.js';
import { PrDetectionLabService } from './pr-detection-lab.service.js';

/** Temporary module — intentional defects for PR review detection tests. */
@Module({
  controllers: [PrDetectionLabController],
  providers: [PrDetectionLabService],
})
export class PrDetectionLabModule {}
